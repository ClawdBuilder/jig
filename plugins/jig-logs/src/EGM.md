# jig-logs src

## Overview

The `logs` tool: one read-only search of an Elasticsearch, OpenSearch or Loki backend over a time window. It checks the call, splits the window into bounded buckets that halve on a timeout or a lost shard, names every gap with a reason, and shapes the hit lines the model reads.

`jig-core` sends the requests, attaches the credential and masks production results.

- **Read with:** [README](../README.md), [Parameters](../docs/parameters.md), [Windows and buckets](../docs/windows-and-buckets.md), [Hit lines](../docs/hit-lines.md), [Failures](../docs/failures.md), [Connecting](../docs/connecting.md).

## Interface

- **Entry** (`index.ts`): the default export registers `tool.definition` with `registerJigTool`, then inside `withJig` declares the tool and registers the `logs` config section with `replace: ["backend.auth"]`, `oneOf: [["backend.auth", "backend.transport"]]`, `methods: LOGS_METHODS` and a `setup` summary with a pending example.
- **Tool** (`tool.ts`): `createLogsTool(deps?)` returns `{ definition, declaration }`; `LogsDeps` is `now` and `timeoutMs`. `declaration.classify` returns `{ environment: target.jigEnvironment, effect: "read" }`.
- **Input** (`params.ts`): `logsParameters` (`additionalProperties: false`), `checkParams`, `resolveQuery`, `resolveView`, `USAGE`, `DEFAULT_WINDOW` (`2h`), `DEFAULT_SIZE` 50, `MAX_SIZE` 200, `MAX_PHRASE_CHARS` 512, `MAX_QUERY_CHARS` 2000, `MAX_TERMS` 5, `MAX_TERM_CHARS` 200. `LogQuery` is in `query.ts`.
- **Config** (`config.ts`): `validateLogsSection`, `settingsFrom` (pure), `logsSettings`, `requireSettings`, `targetFor`; types `LogsSettings`, `Target`, `ElasticTarget`, `LokiTarget`, `Backend`, `Auth` (basic, apiKey, bearer, signIn), `BackendType`. `filter.ts`: `checkFilter`, `isList`.
- **Search** (`search.ts`): `runSearch(query, env)` and `SearchOutcome` (`status` complete, partial or failed; `total` with `eq` or `gte`; per-window reports), `MAX_REQUESTS` 64.
- **Time** (`time.ts`): `parseWindow`, `parseInstant`, `resolveRange`, `planBuckets`, `halve`, `MAX_RANGE_MS` (7 days), `MAX_DEPTH` 4.
- **Requests and failures:** `request.ts` (`sender`, `REQUEST_TIMEOUT_MS` 30000, `MAX_REPLY_BYTES` 16 MiB), `failure.ts` (`FailureReason`, `Failure`, `RequestError`, `failureFromStatus`, `failureFromError`, `nextStep`), `response.ts` (`SearchPage`, `parseBody`).
- **Reading** (`summary.ts`, `line.ts`, `clip.ts`): `summarize`, `View`, `describeHit`, `windowAround`, `clip`, `clipFragment`, `closedOffMarkers`, `DEFAULT_CHARS` 300, `MIN_CHARS` 40, `MAX_CHARS` 4000, `PAGE_HITS` 20.
- **Helpers** (`values.ts`): `InputError` (a `TypeError`), `refuse`, `shown`, `printable`, `plural`.
- **Child:** [`backends/`](./backends/EGM.md): the `LogBackend` seam, Elasticsearch, Loki and LogQL.

## Invariants

- **Every call is an environment-scoped read.** The tool says where it acts and that it reads; `jig-core` decides what that means and masks the result. `masksOwnResults` stays unset, so this plugin masks nothing.
- **Invalid input is refused before anything is sent,** as an `InputError`, so `jig-core` blocks the call without asking. `classify` and `execute` both run `targetFor` and the backend's `checkQuery`. An unknown environment lists the configured names.
- **Limits are checked here, not left to Pi's schema:** `size` 1 to 200, `phrase` up to 512 and `query` up to 2000 characters, 1 to 5 `match` or `exclude` terms of up to 200 printable characters, `chars` 40 to 4000. Exactly one of `phrase` and `query`. An environment `filter` holds 1 to 8 entries of at most 50 values each; a Loki selector is at most 1000 characters.
- **Window rules:** default 2h; `window` matches `^[1-9][0-9]{0,4}[mhd]$` and excludes `from` and `to`; a range is at most 7 days; `to` alone is refused; times need an ISO 8601 timezone; ranges are half open.
- **Buckets halve only on a splittable failure** (timeout, 5xx, a lost connection, `search_timeout`, `failed_shards`, Loki's `window_too_long`), at most `MAX_DEPTH` times and only while fewer than 63 requests are used, and a partial page is dropped when its bucket halves. A 429 is final and never halves. A bucket is capped at the backend's `maxWindowMs`.
- **Budgets:** `MAX_REQUESTS` 64 per call with one kept for the availability probe, an 80 s time budget, 30 s and 16 MiB per request. A window that was not searched is `missing` with the reason `request_budget` or `time_budget`.
- **A gap is named, and the total says "at least"** when a window is missing or partial or the backend only gave a lower bound. A fatal failure (`query_rejected`, `index_not_found`, Loki's `response_too_large`) marks the remaining windows `not_run`.
- **401, 403, redirects and unreachable addresses are thrown,** not a gap, because every window would fail alike. Only `RequestError` becomes a window failure.
- **Errors never repeat a header, body, address or reply.** Messages are fixed text, a status number or an error code. Control characters in shown names become `?`. A `network_error` is always described in the plugin's fixed words — "cannot reach the backend: check backend.url, the network and the certificate" — whichever cause fetch reported, so a host or address from below never reaches the model (`request.ts`, the `network_error` branch).
- **Facts recorded:** `status`, `hits`, `atLeast`, `fetched`, `requests` (through `jig().addFacts`).
- **Secrets are never kept.** Only a secret reference, a sign-in name or a transport name goes to `jig-core`. Config rejects a pasted secret without echoing it, requires `https` for a direct backend, and forbids userinfo, query or fragment in `url`.
- **Config is strict:** only `backend` and `environments`, at most 50 environments named `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`, `backend.auth` needs exactly one credential form and never goes with `transport`. Settings are re-read on every call.
- **A hit line is cut so no JSON object, array or quoted value is left open;** `{…}` and `[…]` mark a cut body.
- **Page size:** without `chars`, a page of 3 or fewer hits is shown at `MAX_CHARS` (4000). Hits per page are `min(20, floor(24000 / (chars + 80)))`, so a large `chars` shows fewer than `PAGE_HITS`. At most 5 gap rows and 3 `Next:` lines are listed.

## Side Effects

- **Network:** at most 64 requests per call, in sequence, through `jig().http.request` (`system: "logs"`, `backend.url` plus the adapter's path). Verbs and paths are the backend's.
- **Registration:** the `logs` tool with Pi, and its declaration and the `logs` section with `jig-core`, inside `withJig`, which waits when `jig-core` loads later. Nothing is read or sent until a call.
- **Progress and facts:** progress text through Pi's `onUpdate`; facts through `jig().addFacts`.
- **No disk, no env vars, no timers.** Per-call state only; the one module-level value is the tool instance.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-logs/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

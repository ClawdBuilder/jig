# jig-api request engine

## Overview

The engine turns a planned request into one sent request and a text the model may read. A `Plan` holds no secret value and carries a fingerprint of everything the user is shown. The engine previews it, sends it once through `jig().http.request`, scrubs the answer and renders it.

Saved requests, variables and refusals live one level up, in [`src/planning.ts`](../EGM.md).

- **Read with:** [README](../../README.md), [code map](../../docs/code-map.md), [Safety](../../docs/safety.md), [Results](../../docs/results.md), [Writes](../../docs/writes.md).

## Interface

- **Plan** (`plan.ts`): `Plan`, `SignIn` (none, bearer, basic, apiKey, oauth, service, transport), `METHODS`, `Method`, `isMethod`, `READ_METHODS` (GET, HEAD, OPTIONS), `sealed`, `fingerprintOf`, `fingerprintOfAll`, `secretsOf`, `describeSignIn`.
- **Preview** (`preview.ts`): `previewOf`, `previewOfAll`, `planLines`. The text the user reads before a request that asks.
- **Sending** (`http.ts`): `createHttp(options?)` returns `Http` with `send(plan, cancel?)`, which resolves to `Sent` (a scrubbed `Answer` plus `notes[]`) or throws `NotSentError` or `LostReplyError`. `HttpOptions` is `timeoutScale` and `now`, both for tests.
- **Wire** (`wire.ts`): `exchange(wire, cancel?, timeoutMs?)`, `Wire`, `Answer`, `NotSentError`, `LostReplyError`, `MAX_ANSWER_BYTES` (2 MiB).
- **Address** (`address.ts`): `addressProblem(address, allowPlainLocal)` returns why an address may not be called, or `undefined`.
- **Pieces** (`text.ts`): `Text`, `Piece`, `Secret`, `Generated`, `Upload`, `Fillers`, `fill`, `fillString`, `displayOf`, `secretsIn`, `generatedIn`, `joined`, `plainOf`, `byteLengthOf`, `upload`, and the guards `isSecret`, `isGenerated`, `isUpload`.
- **Result** (`render.ts`): `renderResult`, `statusLine`, `whereOf`, `shownHeaders`. **Scrub** (`scrub.ts`): `scrubbed`, `REDACTED`. **JSON** (`json.ts`): `prettyJson`.
- **Helpers** (`values.ts`): `InputError`, `isObject`, `oneLine`, `shortList` (re-exports of jig-core's kit), `SHOWN_LINES` (200), `errorMessage`, `shown`.

## Invariants

- **No secret value in a plan.** A secret is a `{ secret, reference }` piece, turned into text only by `fill` at send time. Previews and messages use `displayOf` (`{{name}}`), never a reference or a value. The fingerprint hashes the same display text plus `secretsOf(plan)`, a list of `{ name, reference }`, so a reference (never a value) is in the hash input (`plan.ts:117-126`, `:177`).
- **The address is checked on every send.** `exchange` calls `addressProblem` before `jig().http.request`. Only a company transport that carries the request skips it. No DNS lookup happens here.
- **Never called, whatever the configuration says:** link-local (`169.254/16`, `fe80::/10`), cloud metadata names and addresses, and other forms of this machine (`*.localhost` included). Any address on `127.0.0.1` or `localhost`, `https://` too, needs `allowPlainLocal`; `http://` anywhere else is refused (`address.ts:129-135`).
- **One send, never a retry.** A timeout, cancel or dropped connection is `LostReplyError`. `NotSentError` means nothing went out: an error jig-core marks `notSent` or `auth_failed`, and, before the call, a refused address (`wire.ts:113-116`), a request header the sign-in also sets (`http.ts:60-65`), a secret that cannot be read (`:98-104`) and a refused OAuth token address (`:165-168`). The one retry (a 401 on a cached OAuth token) is jig-core's.
- **No redirects, no cookies.** jig-core uses `redirect: "manual"`. `Set-Cookie` and `Set-Cookie2` are dropped from every answer.
- **Credentials that are one plain secret reference go to jig-core as a reference,** so this plugin never holds the value. A transport adds no header and no auth. Any other credential is filled here and listed for scrubbing.
- **A header the sign-in sets must not also be set by the request** (`NotSentError`, case-insensitive).
- **Every answer passes `scrubbed` before it leaves `send`.** Secrets this plugin read, and the Basic pair, are replaced by `[redacted]` in raw, JSON-escaped and URL-encoded form. Values under 8 characters are not scrubbed.
- **The fingerprint** (32 hex characters of SHA-256) covers collection, request, environment, `jigEnvironment`, sign-in facts, method, URL, sorted lower-cased headers, the displayed body and the secrets list. Preview and execution must give the same one; `tool.ts` enforces that, not this folder.
- **A non-2xx answer is a result, not an error.** A write that ends in 5xx or 408 carries a note to check with a GET first. Answers are capped at `plan.maxAnswerBytes` or `MAX_ANSWER_BYTES`. A body with a NUL byte is binary and its text is emptied.
- **Default headers and preview cuts:** `send` adds `Accept: application/json, text/plain, */*` and `User-Agent: jig-api` as defaults that the request's and the sign-in's headers replace (`http.ts:42-45`, `:195`). A preview's one-line summary is cut at 300 characters and its body at 200 lines, with a note that the whole body is sent (`preview.ts:14-30`).
- **The model sees little of the answer:** the status line, at most 6 headers (content-type, location, trace ids), JSON re-indented without parsing numbers (`prettyJson`), other text cut at 200 lines.

## Side Effects

- **Network:** only `jig().http.request` in `wire.ts`, directly or through a named company transport. This folder opens no socket.
- **Secrets:** `jig().secrets.resolve(reference, cancel)` in `http.ts`, once per secret piece at send time.
- **Randomness and clock:** `fill` uses `crypto.randomUUID()` and `now()` for generated values.
- **Hashing:** `createHash("sha256")` for fingerprints and upload digests.
- **No env vars, no disk, no timers, no module state.** The timeout is passed to jig-core as `timeoutMs`; the OAuth token cache lives in jig-core.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-api/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

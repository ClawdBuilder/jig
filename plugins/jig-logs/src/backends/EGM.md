# jig-logs backends

## Overview

The adapters between the `logs` tool and a log store. `LogBackend` is the seam: it builds one HTTP request per time bucket from the structured input, parses the reply and classifies a failure. Elasticsearch (and OpenSearch) and Grafana Loki are built.

The model's text can only ever become one value inside a request that is otherwise built from configuration.

- **Read with:** [README](../../README.md), [Backends](../../docs/backends.md), [Loki](../../docs/loki.md), [Query grammar](../../docs/query-grammar.md), [Failures](../../docs/failures.md).

## Interface

- **Seam** (`backend.ts`): `LogBackend` (`type`, `config`, `checkBackendFields?`, `checkEnvironmentFields`, `environment`, `limits`, `checkQuery?`, `search`, `probe`, `wire`, `parse`, `classify`, `words`), `Wire` (`method` GET or POST, a `path` starting with `/`, optional JSON `body` and own headers), `Limits` (`maxWindowMs`), `Words`, `ConfigShape`.
- **Registry** (`index.ts`): `backends` (`{ elasticsearch, loki }`) and `backendOf(target)`; a target with no type is Elasticsearch.
- **Elasticsearch** (`elasticsearch.ts`): `elasticsearch`, `searchBody`, `probeBody`, `SEARCH_TIMEOUT` (`25s`), `DEFAULT_TIME_FIELD` (`@timestamp`), `DEFAULT_MESSAGE_FIELD` (`message`).
- **Loki** (`loki.ts`): `loki`.
- **LogQL** (`logql.ts`): `quote`, `literalPattern`, `matcherFor`, `selectorProblem`, `checkPipeline`, `LABEL_NAME`.

## Invariants

- **Read-only, two shapes.** Elasticsearch is always `POST /<index>/_search` with a body of `size`, `timeout`, `track_total_hits`, and `query.bool` (plus `sort` and `_source` when `size` is above 0). Loki is always `GET /loki/api/v1/query_range`, every parameter in the query string. No other verb or path is built.
- **Model text lands in one value.** In Elasticsearch it is the `match_phrase` value or the `query_string.query` string, never a key, field or clause. In Loki it is an escaped line filter or a validated pipeline after the selector.
- **Index, field names and the environment `filter` come only from configuration.** The index matches `[A-Za-z0-9_.*:,-]{1,255}` with no `""`, `.` or `..` part, because it goes straight into the path.
- **Every Elasticsearch request carries the time range** (`gte` from, `lt` to, half open) and the environment filter.
- **The Loki selector is never the model's.** It comes from configuration, is checked by `selectorProblem` and has the configured `filter` matchers spliced in before its closing brace.
- **Loki line filters are case-insensitive:** `phrase`, `match` and `exclude` become `|~` or `!~` with `(?i)` and a regex-escaped literal, through `quote`.
- **`checkPipeline`:** a Loki `query` must start with `|`, hold no control character, no `{` outside a quoted string and no unclosed quote. It runs at `checkQuery` time and again before the request is built.
- **A probe carries no phrase or query,** only the time range and the environment's configured `filter` (Elasticsearch `size: 0`, through `scope()`) or the configured streams with the `filter` matchers and `limit` 1 (Loki, through `streams()`).
- **Limits:** Elasticsearch `maxWindowMs` is unbounded; Loki's `limit` is at most 5000, it cannot count, so its total is `gte` when the lines reach the limit, and `maxWindowMs` is 721 hours (a longer bucket is cut to it). The tool never asks one request for more than its `MAX_SIZE` 200 hits (`../params.ts`), so no backend needs a hit limit of its own.
- **`classify` never repeats reply text.** Loki 413 is final `response_too_large`; a 400 about "max entries limit" is a fatal `response_too_large` that stops the search; a 400 about range or query length is a transient `window_too_long` and the bucket is halved; Elasticsearch `index_not_found_exception` is final. 401, 403 and redirects never reach `classify`.
- **No credential here.** `wire` returns method, path, body and own headers (Loki's `X-Scope-OrgID` from `backend.tenant`); `request.ts` adds the base URL and the sign-in. `SEARCH_TIMEOUT` stays shorter than the 30 s transport timeout.
- **An adapter accepts only its own target type** and throws a plain `Error` on a mismatch (not an `InputError`: it is a bug, not a refusal).

## Side Effects

- **Network** (through the sender in `request.ts`, not in this folder): `POST <backend.url>/<index>/_search` for Elasticsearch; `GET <backend.url>/loki/api/v1/query_range?query=&start=&end=&limit=&direction=` for Loki, with an optional `X-Scope-OrgID` header.
- **Import time:** builds the `backends` registry.
- **Otherwise none:** no I/O, no env vars, no timers, no module state. A refusal is an `InputError` that makes jig-core block the call without asking.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-logs/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

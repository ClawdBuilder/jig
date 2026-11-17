# jig-logs

## Overview

The plugin that gives the agent one tool, `logs`, which searches the logs of one backend (Elasticsearch, OpenSearch or Grafana Loki) over a time window. It only reads. `jig-core` governs every call, sends the requests with the credential and masks production results.

- **Specification:** [README](./README.md).
- **Code:** [src](./src/EGM.md) and [code map](./docs/code-map.md).

## Interface

- **Entry:** `index.ts` re-exports the default of `src/index.ts` so Pi labels the extension `jig-logs`.
- **Tool `logs`:** one search; the tool has no `action` parameter. Parameters: `phrase` or `query`, `environment` (required), `window`, `from`, `to`, `size`, `order`, `match`, `exclude`, `around`, `chars`, `offset`. `phrase`, `match` and `exclude` mean the same on every backend; `query` is in the backend's language (Lucene or LogQL).
- **Config section `logs`:** `backend` (`type`, `url`, and `auth` or `transport`) and `environments` (each with an `index` or a `selector`, an optional `filter` and an optional `jigEnvironment`). Loki adds `backend.tenant`; Elasticsearch environments add `timeField` and `messageField` (defaults `@timestamp` and `message`). Registered with `replace: ["backend.auth"]`, `oneOf: [["backend.auth", "backend.transport"]]`, `methods` for its sign-in methods, and a `setup` summary with a pending example for `/jig setup`.
- **Subfolders:** [src](./src/EGM.md) holds all code; `src/backends` has its own contract (the `LogBackend` seam).
- **Not code, not linked:** `docs/` (parameters, backends, configuration, loki, query-grammar, windows-and-buckets, hit-lines, failures, connecting, not-verified), `skills/logs`, `test/` (fake servers, a fake transport, golden requests in `test/golden`; `test/it/` against real backends).

## Invariants

- **Imports:** a plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`. `plugins/jig-core/test/boundaries.test.ts` enforces it.
- **The public surface is pinned.** The `logs` tool name and the `logs` section are literals in `plugins/jig-core/test/plugin-surface.test.ts`. `audit.test.ts` skips a tool with no `action` parameter, so it has no line for `logs`; `test/tool.test.ts` tests its `classify`.
- **It only reads.** A search is a read in the `jig-core` environment that the environment's `jigEnvironment` names (by default its own name). Production is allowed and masked by `jig-core`; this plugin masks nothing. A name `jig-core` does not know counts as production.
- **What the model writes is a value and nothing else.** Each backend builds its requests in one place. A Loki selector comes only from configuration.
- **No credential in anything the model reads.** A secret is a reference in configuration, resolved when a request is made and attached by `jig-core` or a company transport. An error names a status or error code and never repeats a header, body, address or reply. The plugin does no sign-in and stores no credential.
- **A result says what it covers.** A part of the window not searched is a gap with a reason, and the total is then "at least".
- **Invalid input is refused before anything is sent** and is not asked about. Facts recorded: `status`, `hits`, `atLeast`, `fetched`, `requests`.
- **Generic only.** Examples use `staging` and `api.staging.example.com`; company backends live in a company plugin.

## Side Effects

- **Network:** up to 64 HTTP requests per call, in sequence, through `jig-core`'s request, directly or through a named transport. Elasticsearch uses `POST /<index>/_search`; Loki uses `GET /loki/api/v1/query_range`.
- **Registration:** the tool with Pi; the section and tool declaration with `jig-core`.
- **No disk writes, no env vars, no timers.** Settings are re-read from `jig-core` on every call.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-logs/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`
- Whole suite: `npm test`

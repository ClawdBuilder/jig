# jig-mongo/src

## Overview

The code of the `mongo` tool: it parses and checks a call, plans it as a read or a write, applies the per-environment access lists, reaches MongoDB (directly, through an SSH forward or through a tunnel) and renders the result as Extended JSON.

`jig-core` decides each call by environment and approves writes; this code makes sure what it decided on is what runs. The specification is the [plugin README](../README.md) and `../docs/`.

## Interface

Entry: `jigMongo(options?: MongoOptions): ExtensionFactory` and its `default` export in `index.ts`. `MongoOptions` is `{ connect?, session?, deadlineMs? }` (all for tests; default deadline 90 s per call).

The factory registers the `mongo` section (`validateMongo`, `{ replace: MONGO_REPLACE, setup: MONGO_SETUP }`), `declareTool({ tool: "mongo", plugin: "jig-mongo", classify, preview })`, a `/jig` status line (`statusLines`) and the Pi tool; it connects to nothing until a call.

- **Tool** (`tool.ts`): `createTool(options): MongoTool { definition, classify, preview, shutdown }`. `check` is the one place a call is parsed, matched to a connection and planned; `preview` and `execute` use it, `classify` does not (it decides from the input alone, `tool.ts:281-292`). The tool runs `executionMode: "sequential"`.
- **Setup** (`onboarding.ts`): `MONGO_SETUP`, the plugin's setup questions: one `object` item for a connection, asked either directly (`uri`, `user`, a `password` reference) or through an SSH host (also `via.ssh.host`, `via.ssh.user` and a `via.ssh.key` reference). A credential is asked as a reference, never as a value.
- **Parameters** (`params.ts`): `ACTIONS` (the 20 actions, each with `required`, `optional` and `effect`), `ACTION_NAMES`, `parameters` (the TypeBox schema), `parseCall(input): Call` (which refuses `database` with `service`), `scanJavaScript`, `DEFAULT_LIMIT` 20, `MAX_LIMIT` 2000, `DEFAULT_MAX_TIME_MS` 10 000, `MAX_MAX_TIME_MS` 60 000, `WRITE_CAP` 1000. A `service` is resolved to a database from the connection's map before the call is planned (`tool.ts:114-122`).
- **Planning** (`plan.ts`, `reads.ts`, `writes.ts`): `planCall(call, access, options): Planned` (`{ effect: "read", run }` or `{ effect: "write", run }`), `planRead`, `planAggregateRead`, `planWrite`, `planAggregateWrite`. A `WriteRun` has `prepare` returning `Prepared { preview, fingerprint, counted, send, verify }`.
- **Access** (`access.ts`, `expr.ts`, `filter.ts`, `pipeline.ts`, `write-check.ts`): `createAccess(rules): Access`, `readDeny`, `readAllow`, `readReference`, `projectionFor`, `stripCredentials`, `SYSTEM_DATABASES`; `checkFilter`, `checkExpr`, `checkPipeline` (`MAX_STAGES` 50), `checkUpdatePipeline`, `checkDocument`, `checkUpdate`, `checkBulk` (`BULK_MAX` 100), `checkIndexKeys`, `checkIndexOptions`.
- **Index check** (`require-index.ts`): `PlanOptions { requireIndex }`, `indexCheckFor`, `readPlan`, `enforceIndex`.
- **Config** (`config.ts`, `services.ts`, `settings-types.ts`): `readMongo`, `validateMongo`, `settingsOf`, `accessFor`, `statusLines`, `MONGO_REPLACE`, `connectionKey`, `environmentsOf`, `isProduction`, `checkServices` (service name to database name, at most 100, a `null` drops a company entry); types `Connection`, `MongoSettings`, `Route` (`direct`, `ssh` or `tunnel`) live in `settings-types.ts` and are re-exported from `config.ts`.
- **Connections** (`session.ts`, `route.ts`, `backend.ts`, `driver.ts`): `Session` (`acquire` returns a `Lease`, `closeAll`), `IDLE_MS` (5 min), `startForward`, `sshArguments`, `DEFAULT_ROUTE_TIMINGS`; the `Backend` and `Connect` seam, `connectDriver`, `adaptClient`, `clientOptions`.
- **Results and errors** (`render.ts`, `explain.ts`, `bson.ts`, `ejson.ts`, `errors.ts`, `values.ts`): `renderDocs`, `summarizeExplain`, `toExtended`, `checkExtended`, `RouteError`, `ChangedError`, `InputError`, `RefusedError`, `describeFailure`, `deliveryOf`.

## Invariants

- **Imports:** only `jig-core`'s `contract.ts`, `client.ts` and `kit/` (`tools.ts`, `values.ts`, `ports.ts`, `schema.ts`, `text.ts`). Every action is pinned in `plugins/jig-core/test/audit.test.ts`; a new action also needs its README row (kind column), its line in the audit `TABLE` and its test.
- **`ACTIONS` is the source of the surface.** `test/registration.test.ts` reads the README's tool table (the section from "Tool: mongo" to "Access") and fails when an action or its kind (`read`, `write`, `read, or write` for `aggregate`) disagrees. Change the table and the code together.
- **`classify` uses only the input.** It never reads the config. An unknown action returns `undefined`, so the call is checked before anyone is asked. `aggregate` ending in `$out` or `$merge` is a `write`.
- **Only `InputError` may mean invalid input.** `jig-core` blocks a call on a `TypeError`; `asInvalidInput` turns any other `TypeError` into an ordinary error.
- **Production is read-only,** refused here before any other check as well as by `jig-core`'s floor. Production reads require an index unless the connection sets `requireIndex: false` (the user's choice, shown by `/jig`). A check that cannot be made is a refusal, never a pass.
- **Access is checked before anything runs.** System databases, `system.*` collections and credential-looking field names (`password`, `secret`, `token`, `apikey`, any case) are denied in every environment and cannot be configured away. Production needs an allow list. A denied collection cannot be written.
- **A write is sent once.** `prepare` counts, the fingerprint is compared with `jig().approvedPreview` and a difference throws `ChangedError`. A lost reply is never resent: `verify` reads once. The driver is set with `retryWrites: false` and `retryReads: false`.
- **Server-side JavaScript** (`$where`, `$function`, `$accumulator`, `$code`, `$scope`) is refused unless `javascript: true` for a test environment.
- **`access` opens no connection;** it works with MongoDB down.
- **Config:** unknown fields are errors, a `uri` with a user, a password option or an option that weakens TLS is refused (never echoed back), and `via` of a user replaces a company's whole (`MONGO_REPLACE`).
- **Connections:** one per connection key, closed after 5 idle minutes and at `session_shutdown`; one that failed in use is dropped. Keep the cluster rule: required where an environment has several connections, refused elsewhere.

## Side Effects

- **Network:** connects to MongoDB with the `mongodb` driver (pool of 2, imported on first use) and, for a SOCKS tunnel, through `socks`. A call has a 90 s deadline.
- **Processes:** `ssh -N` local forward through `jig().exec.run` (argument list, no shell, `BatchMode`, `StrictHostKeyChecking=yes`). It ends with the session or after 4 hours.
- **Disk:** the SSH key is written to a mode 0600 file in a `jig-mongo-*` folder under the system temp folder, and deleted once the forward works or fails.
- **Secrets:** `user` (when a reference), `password` and the SSH key are resolved at connect time with `jig().secrets.resolve`; nothing is stored or written to config. This is the documented exception to a plugin never seeing a credential: the driver and `ssh` need it in-process for that connection only, and it is never returned, logged or recorded ([Decisions](../../../docs/decisions.md), the 2026-11-17 entry). There is no sign-in flow.
- **`jig-core`:** `registerSection`, `declareTool`, `status.register`, `addFacts` (record facts), `approvedPreview`, `tunnels.open`, `environments.kindOf`.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-mongo/test/*.test.ts"`
- Integration tests under `plugins/jig-mongo/test/it/` need a real MongoDB and SSH server (see `docs/integration-tests.md` at the repo root) and skip when none is set.
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.

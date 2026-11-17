# jig-api src

## Overview

The `api` tool and its planning. Collections are read into one list of saved requests (`sources/`), a plan is worked out from a saved request, an environment and the agent's variable values (`planning.ts`), and the plan is sent through `jig-core` (`engine/`).

The agent fills variables only: it cannot change a saved request's host, method or headers. Refusals are `InputError`s, mostly in `planning.ts`, and also in `params.ts` (`parseCall`), `catalog.ts`, `ad-hoc.ts`, `resolve.ts` and `tool.ts`.

- **Read with:** [README](../README.md), [code map](../docs/code-map.md), [Variables](../docs/variables.md), [Safety](../docs/safety.md), [Writes](../docs/writes.md), [Parameters](../docs/parameters.md), [Configuration](../docs/configuration.md).

## Interface

- **Entry** (`index.ts`): `jigApi(options?)` returns an `ExtensionFactory`; the default export is `jigApi()`. It registers the `api` section (`API_REPLACE`, `API_METHODS`, `setup: API_SETUP`, `validateApi`) and the tool declaration inside `withJig`, then `registerJigTool` and `registerRefresh`. `ApiOptions` is re-exported.
- **Tool** (`tool.ts`): `createTool(options)` returns `{ definition, classify, preview }` (name `api`, `executionMode: "sequential"`). The request's name, or `collection/folder`, or `call`, is the action.
- **Input** (`params.ts`): `ACTIONS` (one table: `list`, `show`, `run`, `run_folder`, `call`, `postman_environments`), `isAction`, `usage`, `parameters` (one flat object), `parseCall`, `Param`.
- **Config** (`config.ts`): `API_REPLACE` (`environments.*`, `collections.*`), `validateApi`, `readApi`, `settingsOf` (cached per raw object), `jigEnvironmentOf`, `ApiSettings`, `DEFAULT_TIMEOUT_SEC` 30, `MAX_TIMEOUT_SEC` 120. `reference.ts`: `SECRET_REFERENCE`, `checkReference`.
- **Model** (`model.ts`): `SavedRequest`, `Body`, `Auth`, `Template`, `Variable`, `Environment`, `Problem`, `Collection`, `CREDENTIAL_HEADERS`, `declaredSecrets`, `pathOf`. No file format appears here.
- **Setup** (`onboarding.ts`): `API_SETUP`, the plugin's setup questions: one `object` item for a collection (a folder of `.http` files, a Bruno folder or a Postman file; OpenAPI is not offered) and an optional `entry` item for an environment mapping.
- **Catalog** (`catalog.ts`): `loadCatalog(settings)`. A miss or an ambiguity is an `InputError` that lists the known names.
- **Planning** (`planning.ts`): `planRequest`, `planCall`, `PlanContext`, `environmentHosts`, `MAX_SAVED_BODY_BYTES` 1 MiB, `MAX_UPLOAD_BYTES` 10 MiB. `resolve.ts`: `createResolver`, `agentValues`, `secretNamesOf`. `optional.ts`: `pruned`. `template.ts`: `partsOf`, `variablesIn`, `generatedKind`, `unsupportedVariable`. `ad-hoc.ts`: `checkUrl`, `checkBody`, `checkHeaders`, `checkTimeout`.
- **Display** (`show.ts`): `listText`, `showText`, `effectOf`, `refusalOf`. **Refresh** (`refresh.ts`): `registerRefresh`, `refreshCollections`. **State** (`state.ts`): `stateDir`, `apiStateDir`, `makePrivateDir`.
- **Children:** [`engine/`](./engine/EGM.md) (plan, preview, send, scrub, render) and [`sources/`](./sources/EGM.md) (one adapter per collection format).

## Invariants

- **The agent supplies variable values only.** For a saved request there is no host, sign-in or free header parameter. A variable in the host part is refused if the agent gave it, and a destination host must belong to the environment's host set.
- **Secrets never come from the model.** `agentValues` refuses a name that is a secret or a sign-in variable. A secret resolves only from an `api.secrets` reference (`checkReference` refuses a pasted token without repeating it). Planning reads no secret and touches no network.
- **Scripts never run.** A request with a pre-request script is refused by name. Unsupported variables are refused: only `$uuid`, `$guid`, `$timestamp` and `$isoTimestamp` are generated, and a value that needs another request's answer is not.
- **Every refusal is an `InputError`** (a `TypeError` that `jig-core` blocks without asking). A bug's `TypeError` must not pass as invalid input: `preview` turns it into "internal error" (`asInvalidInput`, `tool.ts:218-222`, used at `:306`).
  Known gap: `classify` (`tool.ts:274`) and `execute` (`:319`) do not wrap, so there a bug's `TypeError` reaches jig-core, which blocks the call as invalid input.
- **`model.ts` knows no file format.** A new source changes nothing outside its adapter.
- **GET, HEAD and OPTIONS read.** A name in `api.reads` makes another method a read only outside production. `effectOf` (`show.ts:21-35`) is the one rule: `readsHere` (`tool.ts:148-153`) asks it to classify, `list` says "reads outside production" when no environment is named, and `show` says "writes" in production. A folder is as strict as its strictest request.
- **An environment not mapped in `api.environments` counts as production.** An opt-in collection (OpenAPI) runs in production only with `allowProductionReads`.
- **Ad-hoc `call` needs the environment in `api.adHoc` and is never allowed in production.** Body up to 256 KiB, at most 10 headers (names up to 41 characters, values 1 to 1000), path and query up to 400 characters each from a restricted set, no GET body.
- **The fingerprint is checked again before sending.** `guard` compares the approved preview's fingerprint with a freshly planned one (`fingerprintOfAll` for a folder), or nothing is sent. Classify, preview and execute use the same planning code.
- **A write whose reply was lost is never resent.** `describeFailure` says the outcome is unknown and to check with a GET; a request that never left says nothing was sent. `run_folder` stops at the first failure and marks the rest skipped.
- **`run_folder` values must be used** by some request in the folder, and each request gets only the values it uses.
- **Limits an agent can hit:** a saved body is 1 MiB, or 20 MiB with an upload (each file at most 10 MiB); at most 60 headers (values up to 4000 characters); an agent value is at most 2000 characters; expansion nests at most 8 deep; `list` shows 60 requests, `show` 30 body lines. `api.collections` holds 1 to 50 entries; `environments`, `secrets`, `reads` and `adHoc` at most 200.
- **Settings are re-read on every call.** Without an `api` section the call fails with `NotConfiguredError`.
- **Fetched files live under the state folder's `api/` folder** (mode 0700). `state.ts` copies jig-core's rule instead of importing it, and never changes the state folder's own mode. `/api refresh` is the person's command, not the agent's.

## Side Effects

- **Registration:** the `api` tool with Pi, the `/api` command (`refresh [collection]` only), and the `api` section and tool declaration with `jig-core`. Nothing is read or sent until a call.
- **Network:** only through the sending engine (`engine/http.ts`): a saved or ad-hoc request, the Postman environment list (names and ids), and the `/api refresh` fetch.
- **Disk:** reads collection files on each catalog build and upload files (confined to the collection root). Writes only in `/api refresh`, to `<state>/api/postman-cloud/<id>.json`; `makePrivateDir` creates or tightens `api/` and `postman-cloud/` to 0700 and leaves the state folder's mode alone.
- **Env vars:** `JIG_STATE_DIR` and `XDG_STATE_HOME` (in `state.ts`).
- **In memory:** a per-call catalog that loads each collection once, and the `settingsOf` cache. Facts go to `jig().addFacts`. No timers.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-api/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

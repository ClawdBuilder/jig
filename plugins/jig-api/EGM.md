# jig-api

## Overview

The plugin that lets the agent run the API requests a team already keeps, by name, filling only their variables. Collections (Postman, `.http` files, Bruno, OpenAPI, a Postman cloud workspace) are read into one list.

A request is planned, previewed when it writes, and sent through `jig-core` with the credential. The answer is scrubbed, masked in production and capped.

- **Specification:** [README](./README.md).
- **Code:** [src](./src/EGM.md) and [code map](./docs/code-map.md).

## Interface

- **Entry:** `index.ts` re-exports the default of `src/index.ts` so Pi labels the extension `jig-api`. The factory is `jigApi(options?)`.
- **Tool `api`:** actions `list` and `show` (local reads), `run` (read or write by the request's method), `run_folder` (as strict as its strictest request), `call` (an ad-hoc request, off by default, never production) and `postman_environments` (external read). A request's name is its action, so a rule can name one request.
- **Command:** `/api refresh [collection]`, typed by the person, fetches Postman cloud collections to a local copy.
- **Config section `api`:** `collections`, `environments`, `secrets`, `reads`, `adHoc`, `timeoutSec` (1 to 120, default 30) and `allowPlainLocal`. The section is registered with `replace` for `environments.*` and `collections.*`, `methods` for its sign-in methods, and a `setup` summary with a pending example for `/jig setup`.
- **Subfolders:** [src](./src/EGM.md) holds all code; `src/engine` and `src/sources` have their own contracts.
- **Not code, not linked:** `docs/` (one page per source, parameters, variables, safety, writes, results, auth, configuration, not-verified, code-map), `skills/api`, `test/` (fixtures of an example orders API in every format; `test/it/` against go-httpbin and Keycloak).

## Invariants

- **Imports:** a plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`. `plugins/jig-core/test/boundaries.test.ts` enforces it.
- **The public surface is pinned.** The tool and action names, the `api` command and the `api` section are literals in `plugins/jig-core/test/plugin-surface.test.ts`, and every action's environment, effect and approval is a line in `plugins/jig-core/test/audit.test.ts`.
- **Code map agrees with the code.** A file added to `src/` is listed in [docs/code-map.md](./docs/code-map.md) in the same commit; `plugins/jig-core/test/code-maps.test.ts` fails otherwise.
- **Saved requests first.** The agent fills variables; it cannot change a request's host, method or headers. Ad-hoc calls are opt-in per environment.
- **Hosts are pinned per environment.** A request whose host is not one of its environment's hosts is refused. Link-local and cloud-metadata addresses are never called. Redirects are never followed and no cookies are kept.
- **Scripts never run.** A request that a pre-request script applies to is refused by name.
- **Secrets never come from the model, and are never stored.** A secret variable needs a reference in `api.secrets`; a plain value for it in a file is refused with a warning. A credential that is one plain reference goes to `jig-core` as a reference; one built into a header, a body or a sign-in is resolved here at send time (`src/engine/http.ts:93`) and kept only for that send. No `.env` file is read.
- **No sign-in flow.** Only headless sign-in: bearer, Basic, an API key in a header, OAuth client credentials or a password grant. The Postman CLI and `bru` sign in themselves; Jig never does.
- **Reads run, writes ask, production writes are denied.** An unmapped environment counts as production. A write with no answer is never resent: the error tells the model to check with a GET, and the plugin does no check of its own (`src/tool.ts:54-64`).
- **A preview is tied to the send.** The plan's fingerprint is compared again before sending.
- **Generic only.** Examples use `orders-api`, `staging` and `api.staging.example.com`.

## Side Effects

- **Network:** only through `jig-core`'s request, from the sending engine: saved and ad-hoc requests, the Postman environment list, and the `/api refresh` fetch (`api.postman.com` or `api.eu.postman.com`).
- **Disk:** reads collection files and upload files inside the collection folder. Writes only during `/api refresh`: `<state>/api/postman-cloud/<id>.json` (mode 0600, through a temporary sibling renamed over it). It also creates `api/` and `postman-cloud/` with mode 0700 and tightens them when they exist (`src/state.ts:23-34`); the state folder above belongs to `jig-core`, so its mode is left alone.
- **Env vars:** `JIG_STATE_DIR` and `XDG_STATE_HOME`, to find the state folder.
- **Registration:** the tool and command with Pi; the section and tool declaration with `jig-core`. Nothing is read or sent until a call.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-api/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`
- Whole suite: `npm test`

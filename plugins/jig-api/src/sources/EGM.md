# jig-api sources

## Overview

The adapters that turn a team's files into the one list of saved requests that `model.ts` describes: Postman exports, `.http` folders, Bruno collections (OpenCollection YAML and `.bru`), OpenAPI specs, and a Postman cloud workspace kept as a local copy.

Every source is a read-only parser. No script is run, and a secret is an empty slot that `api.secrets` fills.

- **Read with:** [README](../../README.md), [Sources](../../docs/sources.md), [code map](../../docs/code-map.md), [Postman cloud](../../docs/postman-cloud.md), [Bruno](../../docs/bruno.md), [OpenAPI](../../docs/openapi.md), [`.http` files](../../docs/http-files.md).

## Interface

- **Seam** (`source.ts`): `Source<Config>` with `kind`, optional `handles(entry)`, `check(entry, at, errors)` (pure, no disk), synchronous `load(config, name): Collection`, and optional `refresher` and `environmentLister`. Also `Refresher`, `RefreshDeps`, `RefreshReport`, `EnvironmentLister`.
- **Registry** (`index.ts`): `SOURCES = [postman, httpFile, bruno, openapi, postmanCloud]`. `config.ts` picks by `kind`, then the first source whose `handles` is true. Adding a source is adding its file here.
- **Postman** (`postman.ts`): `postman` (kind `postman`), plus `collectionFrom`, `environmentFrom` and `PostmanContent`, which the cloud source reuses. Helpers: `postman-request.ts` (`walk`, `scriptOf`), `postman-auth.ts` (`authOf`), `postman-body.ts` (`bodyOf`), `postman-values.ts`.
- **Postman cloud** (`postman-cloud.ts`, `postman-api.ts`): `postmanCloud` (has `handles`, `refresher`, `environmentLister`), `fetchJson`, `listEnvironments`, `LIST_LIMIT` 200.
- **`.http` files** (`http-file.ts`): `httpFile` (kind `http`).
- **Bruno** (`bruno.ts`): `bruno` (kind `bruno`). Parts: `bruno-tree.ts`, `bruno-request.ts`, `bruno-environments.ts`, `bruno-reading.ts`, `bruno-bru.ts`, `bruno-yaml.ts`, `bruno-types.ts`.
- **OpenAPI** (`openapi.ts`): `openapi` (kind `openapi`). Parts: `openapi-spec.ts` (`readSpec`, `dereferencer`), `openapi-operation.ts`, `openapi-security.ts`, `openapi-body.ts`.
- **Shared:** `files.ts` (`expandHome`, `readText`, `confined`, `readFailure`), `texts.ts` (`authTexts`, `bodyTexts`), `yaml.ts` (`parseYaml`).

## Invariants

- **`load` is synchronous, reads local files only and does not throw for file content.** A bad file, key or secret is a `Problem` and the rest of the collection loads. `check` never touches the disk.
- **Scripts never run.** A request that a pre-request script applies to is refused by name; test scripts and response handlers are ignored with a note. Bruno `assert` blocks are read and shown, not run.
- **Unsupported is listed and refused, never guessed:** WebSocket, gRPC, MQTT, Digest auth, non-HTTP schemes, an OpenAPI operation with no `operationId` (or a repeated one), and a cloud request that uploads a file.
- **A secret never gets a value from a file.** Postman `type: secret`, every key of `http-client.private.env.json`, Bruno secret variables and `{{process.env.NAME}}` become `{ value: "", secret: true }`. No `.env` file is read. OpenAPI credentials are empty secret slots.
- **OpenAPI hosts come only from the configured `servers` map;** an environment with no server is unavailable. `allowProductionReads` defaults to false. A server address with a user, query or fragment is rejected.
- **Links are not followed** when a folder is scanned, and `confined(root, file)` rejects a path outside its collection after resolving real paths.
- **Byte caps refuse; counts and depth skip with a warning.** Postman collection 32 MiB, environment 2 MiB, at most 20 environments; `.http` file 1 MiB; Bruno file 1 MiB; OpenAPI spec 8 MiB; cloud copy 32 MiB. Past 500 `.http` files only the first 500 are read (`http-file.ts:174-178`); past 1000 Bruno files the rest are skipped, and a folder deeper than 12 is skipped (`bruno-tree.ts:92-122`).
- **`check` is strict.** Unknown fields are errors, local paths are absolute or start with `~/`, and cloud ids match a fixed pattern. A browser-based OAuth flow is refused; only client-credentials and password OAuth2, bearer, basic and API-key auth are read.
- **The cloud call is one GET.** The key is a secret piece, `{ secret: "apiKey", reference }`, resolved by jig-core when sent, so it is never in the copy, a message or an error. A `transport` and a `signIn` together are rejected.
- **The cloud `load` reads only the local copy.** A missing copy says to run `/api refresh <name>`. Secret environment values are blanked before the copy is kept. A failed collection fetch, or a copy that cannot be saved, leaves the previous copy and is reported, not thrown. A failed environment fetch keeps that environment's earlier copy and marks the refresh failed, but the fetched collection and the other environments are still written over the copy (`postman-cloud.ts:351-376`).
- **`listEnvironments` returns names, ids, owner and update time only,** never values.

## Side Effects

- **Disk reads:** the configured Postman exports, a Bruno folder, an OpenAPI file, a folder of `.http` and `.rest` files with `http-client.env.json` and `http-client.private.env.json`. Directories are walked in sorted order. `os.homedir()` expands `~/`.
- **Disk write (cloud refresh only):** `<state>/api/postman-cloud/<id>.json`, mode 0600 in a 0700 folder, replaced durably so a reader never sees half a file.
- **Network (cloud only):** GET `https://api.postman.com` or `https://api.eu.postman.com` (by `region`) for `/collections/<id>`, `/environments/<id>` and `/environments`, through the sending engine, with the key filled by jig-core. The call honours `timeoutSec` and the abort signal.
- **No other state.** Other loads re-read the disk each time and hold no cache. `fetchedAt` is stamped on a refresh.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-api/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

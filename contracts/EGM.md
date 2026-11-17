# contracts

## Overview

The published front-end contracts: what an optional front-end (such as `jig-herdr`, in its own repository) may read or write without importing Jig's `src/`. They ship in the npm package (`contracts/**`).

Surfaces and versions: [Front-end contracts](../docs/contracts.md). A breaking change needs a version bump and a [Decisions](../docs/decisions.md) entry.

**Only `palettes.json` is generated.** `requests.js` and `requests.d.ts` are hand-written.

## Interface

- **`requests.js`** (plain JS, imports only Node modules): the session-request format a reader writes and `jig-session` takes.
  - `REQUEST_SCHEMA = 1`, `MAX_REQUEST_BYTES = 65536`.
  - `parseRequest(text): { request } | { error }`. A `request` is `{ schema: 1, id: string | null, tools, skills, reload }`: `tools` and `skills` map names to booleans, `reload` is a boolean. An id that fails `^[A-Za-z0-9._:-]{1,100}$` becomes `null`; names must match `^[A-Za-z0-9_.:/-]{1,128}$`; unknown fields are ignored.
  - `takeRequest(file): string | null | undefined`: renames the file to a unique `.taking` name, then reads it. `undefined` when the rename or read fails, `null` when over `MAX_REQUEST_BYTES`.
  - `ensureRequestsDir(dir)`: creates the folder with mode `0o700`.
  - `sweepRequests(dir, live, keep, now?): string[]`: removes a `.json` file `live` does not name, and any other file older than 60 seconds; never `keep`. Returns the removed names.
- **`requests.d.ts`**: types for the above (`Request`, and the four function signatures).
- **`palettes.json`**: an object keyed by theme file name (`jig-ember.json`, `jig-lime.json`, `jig-mono.json`, `jig-orchid.json`, `jig-paper.json`, `jig-signal.json`); each value is that theme file (`name`, `appearance`, `vars`, `colors`, `export`).
- **Producer and twin:** `palettes.json` is built by `scripts/build-contracts.mjs` from `plugins/jig-theme/themes/`. `requests.js` has a TypeScript twin in `plugins/jig-session/src/requests.ts`, which the session itself uses.

## Invariants

- **Do not hand-edit `palettes.json`.** Change a theme file in `plugins/jig-theme/themes/`, then run `node scripts/build-contracts.mjs`. The output is `JSON.stringify(palettes, null, 4)` plus a newline, in file-name order; `--check` fails on any difference.
- **`requests.js` and the session twin behave the same, input for input.** Change both together; `test/contracts.test.ts` runs a shared corpus through each.
- **Compatible changes only:** a new optional field is fine; a field rename, a removed field or a new required field is a break (new `REQUEST_SCHEMA`).
- **A request never approves a call.** It only turns tools or skills on or off, or asks for a reload.
- **No import from `plugins/` or `src/`** in `requests.js`: front-ends import it from the published package.
- **Neutral content.** No company names or secret-shaped values in a palette or a request example.

## Side Effects

- `requests.js` touches disk only in the folder it is given: `renameSync` and `rmSync` (take a request, sweep strays), `readFileSync`, `statSync`, `readdirSync`, `mkdirSync` (mode `0o700`). No network, no processes.
- `palettes.json` and `requests.d.ts` are data and types only.
- `scripts/build-contracts.mjs` (without `--check`) rewrites `palettes.json`.

## Verification

- Run: `npm run check:contracts` (is `palettes.json` current).
- Run: `node --import ./test/support/host.mjs --test test/contracts.test.ts` (twin agreement and palette equality).
- Also part of `npm run check` and `npm test`.
- See [jig-theme](../plugins/jig-theme/README.md) for the palettes' source.

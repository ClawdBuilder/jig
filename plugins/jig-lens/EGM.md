# jig-lens

## Overview

`jig-lens` shows what `jig-core` records: cost, tool failures, blocked calls and time spent waiting for the user. It imports the record files into its own SQLite index and answers `/lens` in Pi, on a local page (`/lens web`), or through Grafana or Datasette.

Behavior, commands and settings are specified in the [README](./README.md) and `./docs/`; this file is the map for a change.

## Interface

- **Entry:** `index.ts` re-exports the default of `./src/index.ts`, so Pi labels the plugin by its folder name. Keep it a one-line re-export.
- **Code:** [src](./src/EGM.md) holds all logic: the import, the `/lens` command, the figures, the page server, the viewers and the usage view.
- **Command:** `/lens [ticket KEY | session [id] | days N | compare [days N] | usage | web | grafana | datasette | rebuild | status]`.
- **Config:** the `lens` section of `jig.json`, one field: `port` (default 3300, for Grafana or Datasette). The section is registered with a `setup` summary for `/jig setup`. The `/lens web` page also reads the `ui` section's `theme` as a fallback for Pi's saved theme.
- **Event bus:** other plugins may emit `jig-lens:model-names` to name models in the usage view.
- **Non-code siblings** (no contract file):
  - `viewer/`: Grafana provisioning and dashboards as JSON and YAML, and Datasette's `metadata.json` with its canned queries. Read by tests that run every query.
  - `web/`: `index.html`, the whole page of `/lens web`, with its styles and script inline.
  - `docs/`: the detail pages the README links under "More detail".
  - `test/`: sample records, a fake Pi and a real Pi session.

## Invariants

- **The README and the docs are read by tests.** `test/docs.test.ts` checks links, anchors, the README's shape and that every page is linked under "More detail". `scopes.test.ts` runs the README's example against the code. Change docs and code in the same commit.
- **Read-only over `jig-core`'s records;** the index is a rebuildable copy. Nothing leaves the machine.
- **A plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`.** Every tool action is pinned in `plugins/jig-core/test/audit.test.ts`; this plugin has no tools, only the `/lens` command and the `lens` config section.
- **The `lens` config section is validated by `jig-core`** through `validateLens`; a mistake names the key and the defaults apply. A new field changes the README table and `validateLens` together.
- **Dashboards and the page read the index through fixed queries.** A column or table change updates `viewer/`, the page and [index schema](./docs/index-schema.md) together.
- **No credentials and no sign-in flow.** Grafana's own sign-in stays on; the plugin stores no token.

## Side Effects

- **Disk:** writes only under `<state>/lens` (index, Grafana data, viewer log); reads `jig-core`'s record files, Pi's session files and Pi's saved theme (`<agentDir>/theme.json`, for the page). Details in [src](./src/EGM.md#side-effects).
- **Network and processes:** a local page on 127.0.0.1 for the session; Grafana or Datasette detached on `lens.port`; a browser opener. No outbound traffic.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-lens/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.

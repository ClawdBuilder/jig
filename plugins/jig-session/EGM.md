# jig-session

## Overview

`jig-session` is a Pi extension that publishes what a Pi session is doing as one small JSON status file per session, for any program to read: terminal, model, context and what fills it, cost, ticket, workflow stage, the files changed and the recent tool calls with `jig-core`'s decision on each.

A reader may send one kind of request through a file: switch a tool or skill for this session, or reload Pi when idle.

With `session.compactWhenIdle` set, it also compacts the session while the person is away, a little before the provider's prompt
cache expires.

The format and behavior are specified in the [README](./README.md), [the status file](./docs/status-file.md), [how it works](./docs/how-it-works.md) and [context and requests](./docs/context.md).

## Interface

- **Entry:** `index.ts` re-exports the default of `./src/index.ts`, so Pi labels the plugin by its folder. Keep it a one-line re-export.
- **Code:** [src](./src/EGM.md) holds the event handlers, the status file, the request handling and the context breakdown.
- **Files it writes:** `<state dir>/sessions/<session id>.json` (schema 1) and it takes `<state dir>/requests/<same name>.json`. The state dir is `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`.
- **Commands:** `/context`, `/session-file`, `/session-reload`. It has no tool. It registers one section, `session`
  (`compactWhenIdle`), and reads the `memory`, `workflow` and `jira` (`site` only) sections.
- **Non-code siblings** (no contract file): `docs/` (the pages the README links) and `test/` (the file written, updated and removed; outputs, ticket, workflow; breakdown, requests, switches, reload).

## Invariants

- **One status file per session, files only.** No port, no network, never an argument value, command line or secret. Readers (the Herdr app files in `ClawdBuilder/jig-herdr`) poll it, so the format is a published contract.
- **Change the format only as the README says.** Adding a field is fine. Removing or renaming a field, or changing its meaning, needs a new `schema` (`2`) and an entry in `docs/decisions.md`; `docs/contracts.md` lists the file. Update the README table and `docs/status-file.md` with the code.
- **A request never approves a call.** `jig-core` decides every call, whatever a request switched on.
- **A plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`.** The plugin repeats the folder rules of `jig-core`, `jig-memory` and `jig-workflow` instead of importing them.
- **No credentials, no sign-in flow.** Nothing here stores or reads a secret.
- **A child Pi (`jig-agents`) writes nothing:** it runs in its parent's terminal.

## Side Effects

- **Disk:** writes the two folders above (0700, files 0600, by rename); removes its files at shutdown and sweeps those of dead processes. Reads ticket and workflow files. Details in [src](./src/EGM.md#side-effects).
- **Process:** a 2 s unref'd timer; it calls `setActiveTools`, `appendEntry` and Pi's reload, and `ctx.compact()` when
  `session.compactWhenIdle` says the session has been idle long enough. The idle timer is cancelled by any input, turn, tool call
  or extension prompt.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-session/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.

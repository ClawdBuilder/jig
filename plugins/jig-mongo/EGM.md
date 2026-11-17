# jig-mongo

## Overview

`jig-mongo` gives the agent one tool, `mongo`, for MongoDB: exploring, querying, indexes, query plans, aggregation and writes. `jig-core` decides each call by environment (reads run, a test-environment write asks with a preview, a production write is denied).

This plugin adds allow and deny lists that reach fields, an index check for production reads, count-checked write previews and the routes to the database. Behavior is specified in the [README](./README.md) and `./docs/`.

## Interface

- **Entry:** `index.ts` re-exports the default of `./src/index.ts` so Pi labels the plugin by its folder. Keep it a one-line re-export.
- **Code:** [src](./src/EGM.md) holds the tool, the access walk, planning, the index check, connections and routes.
- **Tool `mongo`:** 20 actions, `access`, `databases`, `collections`, `schema`, `stats`, `indexes`, `index_stats`, `explain`, `count`, `find`, `distinct`, `sample`, `aggregate`, `insert`, `update`, `replace`, `delete`, `bulk`, `create_index`, `drop_index`. `aggregate` is a write when its last stage is `$out` or `$merge`.
- **Config:** the `mongo` section of `jig.json`: `connections` (at most 20 environments, each with one connection of `uri`, `user`, `password`, `authSource`, `tls`, `via`, `requireIndex`, `services`, or up to 10 connections by name, in which case `access` is given per connection name) and `access` (`deny`, `allow`, `javascript`). A connection's `services` maps a service name to the database name this environment uses for it, so a call gives `service` instead of `database`. The section is registered with `replace` for a connection's `via` and a `setup` summary with a pending example for `/jig setup`; the README's JSON example is valid configuration, and a test checks it.
- **Skill:** `skills/mongo/SKILL.md` teaches the agent to count before find, explain before blaming the database, preview every write and never write to production. A test checks it against the README.
- **Non-code siblings** (no contract file): `docs/` (detail pages linked from the README), `skills/` (the skill above), `test/` (fakes of `jig-core`, the database and ssh; `test/it/` runs against a real MongoDB and SSH server).

## Invariants

- **Change the README table and its test together.** `test/registration.test.ts` reads the tool table of the README and fails when an action or its kind (`read`, `write`, `read, or write`) differs from `ACTIONS` in `src/params.ts`. The README must keep the headings listed there and stay short, with detail in `docs/`.
- **Every action is pinned in `plugins/jig-core/test/audit.test.ts`:** a README or docs row, a line in its `TABLE` with environment, effect and approval, and a test that names it. A new action changes all of these in one commit. Never loosen a pin to get green.
- **A plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`** (`test/boundaries.test.ts` in `jig-core`).
- **Production is read-only and masked,** whatever the config says. Lists reach fields, and credential-looking fields are denied everywhere.
- **Credentials come from secret references** resolved through `jig-core` when a connection opens. The config never holds a password or key, and the plugin stores none and has no sign-in flow. This is the documented exception to a plugin never seeing a credential: the driver and `ssh` need the value in-process, it is used for that connection only, and it is never returned, logged or recorded ([Decisions](../../docs/decisions.md), the 2026-11-17 entry). Do not add a setting that lowers the permission floor.
- **A `service` is resolved before planning,** from the connection's `services` map: an unmapped name is refused with the ones that connection knows, and `database` and `service` together are refused.
- **Writes are previewed, counted and sent once;** a lost reply is checked by one read, never resent.

## Side Effects

- **Network and processes:** MongoDB connections, an `ssh -N` forward or a tunnel opened through `jig-core`, only when a call is made. Details in [src](./src/EGM.md#side-effects).
- **Disk:** a mode 0600 temporary file for an SSH key, deleted once the forward works or fails. Nothing else is written.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-mongo/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.
- Integration: `npm run test:it` needs a real MongoDB and SSH server and skips when none is set.

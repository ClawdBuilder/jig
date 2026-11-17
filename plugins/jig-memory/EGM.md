# jig-memory

## Overview

`jig-memory` keeps what the agent learns about a ticket in files that outlive the session, sums a closed ticket up in a short card, and hands the agent related earlier tickets (their cards, or entries derived from their notes) when a new ticket starts.

Specification: [README](./README.md); detail pages are under `docs/`, starting with [Behaviour](./docs/behaviour.md) and [Recall](./docs/recall.md).

## Interface

- **Entry**: `index.ts` re-exports the default of `./src/index.ts`. The entry sits at the plugin root so Pi labels the extension `jig-memory`; the code stays in `src/`.
- **Tool** `ticket`: actions `save_evidence`, `add_check`, `list_checks`, `close_check`, `recall`, `close`.
- **Command** `/ticket`: `KEY`, bare, `off`, `close [KEY]`, `recall [text]`.
- **Config section** `memory` in `jig.json`: `folder`, `ticketPattern`, `recall.*`. The section is registered with a `setup` summary for `/jig setup`.
- **Code**: [src contract](./src/EGM.md); [scripts contract](./scripts/EGM.md) for the recall measuring script.
- **Not code**:
  - `skills/ticket-memory/SKILL.md`: how the agent dates notes and keeps `## Now` current.
  - `docs/`: [Configuration](./docs/configuration.md), [Behaviour](./docs/behaviour.md), [Handoff](./docs/handoff.md), [Cards](./docs/cards.md), [Recall](./docs/recall.md), and [the code map](./docs/code-map.md).
  - `test/`: one file per module, `support.ts` (a fake `jig-core` and a fake Pi) and `recall-eval/` (invented cards and queries).

## Invariants

- **Plugin boundary.** Import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`; tests enforce it. No credentials are used, stored or seen, and there is no sign-in.
- **Files outlive the session and are never half-written.** Every file is synced before it takes its name.
- **Derived notes are off by default in automatic recall** (`recall.notes: false`); the README gives the measured reason. Do not turn it on without new numbers from the recall test. Manual recall (`/ticket recall`, the tool's `recall`) always searches notes entries (`maxNotes` at least 1).
- **Pinned surface.** The `ticket` tool, its actions and `/ticket` are literals in `plugins/jig-core/test/surface.test.ts` and `plugin-surface.test.ts`, and every action is in `plugins/jig-core/test/audit.test.ts` with its effect and approval. Add to the pins when adding; a removal needs a Decisions entry first.
- **README and code move together.** The README is the specification. A change to a field, an action or a limit changes the README or `docs/` in the same commit.
- **Generic only.** No company names or internal systems; examples use `PROJ-123`.

## Side Effects

- **At load**: registers the `memory` section (with its `setup` summary) and the `ticket` declaration with `jig-core`; touches no file.
- **At run**: creates and writes the ticket folders under `~/.local/share/jig/tickets` (or `memory.folder`) once a ticket is active. Full list in [src contract](./src/EGM.md#side-effects).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-memory/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.

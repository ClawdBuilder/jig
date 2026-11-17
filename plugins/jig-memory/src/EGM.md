# jig-memory src

## Overview

Ticket memory for Pi. It keeps one folder per ticket outside every repository (notes, evidence, checks, card), sends notes, reminders and recall to the agent as messages, and registers the `ticket` tool and `/ticket` command. Cards and notes are indexed for recall of related earlier tickets.

Specification: [README](../README.md); detail: [Behaviour](../docs/behaviour.md), [Handoff](../docs/handoff.md), [Cards](../docs/cards.md), [Recall](../docs/recall.md).

## Interface

- **Entry**: `index.ts` default `function (pi)`. In `withJig` it registers the `memory` section with a `setup` summary and declares the tool, then calls `registerTicketMemory(pi)`. It touches no file.
- **Wiring**: `session.ts` (`registerTicketMemory`, `restoredTicket`, `offeredTickets`, entry names `TICKET_ENTRY` and `CLOSE_OFFER_ENTRY`, message names `NOTES_MESSAGE`, `RECALL_MESSAGE`, `EMPTY_FILES_MESSAGE`, `CHECKS_MESSAGE`); `notices.ts` (`note`, `reason`, `warnEmptyFiles`), the one line a hook shows and the empty-files warning.
- **Tool `ticket`** (`tool.ts`: `TOOL_NAME`, `ACTION_NAMES`, `checkInput`, `classify`, `declaration`, `ticketTool`, `finishPasted`): actions `save_evidence`, `add_check`, `list_checks`, `close_check`, `recall`, `close`; `additionalProperties: false`; environment `local`, a read for `list_checks` and `recall`, a write otherwise.
- **Command `/ticket`**: `KEY`, bare, `off`, `close [KEY]`, `recall [text]`. The words `off`, `close` and `recall` cannot be keys.
- **Config section `memory`** (`config.ts`: `validateMemory`, `recallOf`, `folderOf`, `ticketRegex`, `RECALL_DEFAULTS`, `RECALL_MAX`): `folder`, `ticketPattern`, `recall.{enabled,max,minScore,notes,maxNotes}`.
- **Folder**: `store.ts` (`ticketPaths`, `isSafeKey`, `ensureTicket`, `settleNotes`, `createFile`, `replaceFile`, `readText`), `notes.ts` (`## Now` helpers), `evidence.ts`, `checks.ts`, `empty-files.ts`, `message.ts`, `clip.ts` (`clipBytes`).
- **Cards**: `card.ts` (format and validator), `close.ts` (`draftClose`, `verifyCard`), `cards.ts` (`.cards.json`: `entryOf`, `loadCards`), `material.ts`.
- **Recall**: `extract.ts` (keys, identifiers, error lines), `bm25.ts`, `notes-index.ts` (`.notes.json`: `noteEntryOf`, `loadNoteIndex`), `recall.ts` (`buildQuery`, `recall`, `recallMessage`).
- **Used by script**: [scripts contract](../scripts/EGM.md) imports `entryOf`, `RECALL_DEFAULTS`, `noteEntryOf`, `buildQuery`, `recall`, `recallMessage`, `isSafeKey`, `readText`, `ticketPaths`.

## Invariants

- **Imports from `jig-core`** are only `client.ts`, `contract.ts` and `kit/` (`files`, `jig-messages`, `schema`, `tools`, `values`).
- **Nothing is touched until `session_start`** has read `memory` and a ticket is active. Without `ticketPattern`, no key is detected.
- **A key is a folder name.** It must match `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` (`isSafeKey`). The `ticket` tool's `close` refuses a ticket folder that is a symlink or not a directory (`session.ts:552-561`); `/ticket close` only checks that it exists, and activation (`ensureTicket`) checks nothing. A symlinked draft card is refused on write and read (`close.ts:57`, `98`).
- **Durable writes.** Folders `0o700`, files `0o600`, through `createFileDurably` and `replaceFileDurably`, so a crash never leaves an empty file. In `settleNotes` the `history/` file is written before `notes.md` is rewritten, so a failure loses nothing. `evidence/index.md` is appended.
- **Messages, never the system prompt.** Notes and open checks reach the agent as messages (`triggerTurn: false`), so the prompt cache stays valid. The card request, its correction and the close offer use `triggerTurn: true`, `deliverAs: "followUp"`.
- **Only user input activates a ticket.** `input` with source `extension` is ignored. A second ticket while one is active gives a hint once. Several keys in one message activate none.
- **Evidence is masked.** Every tool result while a ticket is active is saved, except Pi's file tools and `ticket` itself, clipped to 8 KB. Pasted text is masked with `jig().mask.text`; `finishPasted` saves it only after `jig-core` has cleaned the result and answers with the file name, not the text. Pasted limit 48 KB.
- **Limits.** `## Now` under 1,024 bytes (keep 768); notes in a message 16 KB; a card section at most 400 characters (Problem, Cause, Fix); a check's text 200 characters; 20 open checks; reminder after 15 results with no `## Now` change; empty-file notice for files changed in 7 days, 10 shown.
- **One correction, no loop.** At `agent_settled` a card that fails the check gets one correction message, then a warning. One close is pending at a time. An existing card needs `update: true`. A close refreshes `.cards.json` and deactivates the ticket if it was active.
- **Recall.** Automatic recall runs once per new ticket per session, with `maxNotes` at most 1 and no rare words. Manual recall (`/ticket recall`, the tool) may use rare words and notes entries. A written card beats a derived notes entry; `notes-index.ts` never reads or writes evidence. Both indexes are copies, rebuilt when missing or unreadable.
- **`jig:stage-done`** offers a close only when `last === true`, `via === "advance"`, the ticket is the active one and the names and date parse, and only once per ticket (`CLOSE_OFFER_ENTRY`).
- **Hooks never throw.** Errors are caught and shown with `ctx.ui.notify` when there is a UI; the prompt goes on without a ticket. `session_start`'s restore (`setTicket`, `ensureTicket`, `settleNotes`, the empty-files warning) and `session_compact` (`settleNotes` and the notes message) each catch a file system error and say it in one line (`session.ts:340-354`, `:357-368`), so a read-only or removed folder cannot fail Pi's hook.
- **Input errors block without asking** (`InputError`): unknown action, a field the action does not use, a missing field, a wrong type, an empty recall query.
- **README, docs and pins.** Tool and action names are pinned in `plugins/jig-core/test/surface.test.ts` and `audit.test.ts`. Change README and code together.

## Side Effects

- **Disk base folder**: `memory.folder` (`~/` expanded), else `$XDG_DATA_HOME/jig/tickets` when `XDG_DATA_HOME` is absolute, else `~/.local/share/jig/tickets`.
- **Per ticket** `<folder>/<KEY>/`: `notes.md`, `history/`, `evidence/` with `index.md`, `ticket.json`, `checks.json`, `card.md` and a draft card. `plan.md` is created here on every activation or restore, with `# <KEY> plan`, and never read here; `jig-workflow` reads it.
- **Folder level**: `.cards.json` and `.notes.json`.
- **Env read**: `XDG_DATA_HOME` only.
- **Pi hooks**: `session_start`, `session_compact`, `before_agent_start`, `agent_settled`, `input`, `tool_result`; bus event `jig:stage-done`; `pi.registerCommand("ticket")`, `pi.appendEntry`, `pi.sendMessage`.
- **`jig-core` calls**: `registerSection("memory")`, `declareTool`, `config.section`, `setTicket`, `records?.recall` (entry count and no text), `mask.text` and `addFacts` (`{ entries, queries: 1 }` for `recall`, `{ closed: 1 }` for a drafted `close`).
- **No** network, child processes or timers.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-memory/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.

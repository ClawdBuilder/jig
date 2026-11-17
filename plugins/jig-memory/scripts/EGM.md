# jig-memory scripts

## Overview

One measuring script, `recall-eval.mjs`. It runs the plugin's recall over a folder of tickets and prints only counts, rates and booleans, so it can be run on real tickets without leaking their content. Background: [Recall](../docs/recall.md).

## Interface

- **Command**: `node plugins/jig-memory/scripts/recall-eval.mjs --folder <tickets> [options]` from the repo root. It has a shebang and no exports.
- **Options**: `--labels <json>`, `--mode notes|cards|both`, `--min-score N`, `--max N`, `--top N`, `--lines N`, `--rule on|off`, `--gate auto|manual`, `--max-notes N`. Defaults: `notes`, the recall defaults, top 3, 25 lines, `on`, `auto`.
- **Imports from `../src`**: `entryOf` (`cards.ts`), `RECALL_DEFAULTS` (`config.ts`), `noteEntryOf` (`notes-index.ts`), `buildQuery`, `recall`, `recallMessage` (`recall.ts`), `isSafeKey`, `readText`, `ticketPaths` (`store.ts`). Renaming any of them breaks this script.
- **Output**: one JSON object of numbers and booleans (or `{"modes": [...]}` for `--mode both`), covering tickets, cases, hits, `recallAt3`, noise and the size of automatic messages.

## Invariants

- **Never prints content.** No note, card or label text reaches stdout. Any failure prints exactly `{"error":true}` and sets exit code 1, with no stack trace. The `../src` imports are dynamic inside the `try` so an import failure behaves the same.
- **The labels file is read, never printed, copied or committed.**
- **Every ticket key in the folder is redacted** from queries and index text, so a shared key cannot be why a result came back.
- **Only folders whose names pass `isSafeKey` are scanned.**
- **The gates mirror the plugin.** `auto` uses one derived note and no rare words; `manual` uses `top` notes and allows rare words. Labelled-case and notes-mode no-link recalls are asked for `max(max, top)` entries, so the top N is real; the cards-mode no-link recall and the automatic-message recall ask for `top` (`recall-eval.mjs:231`, `275`).
- **A bad argument is an error object:** `--folder` is required, `top` is an integer of at least 1, and `rule`, `gate` and `mode` take only their listed values.

## Side Effects

- **Reads only**: the `--folder` tickets (`<KEY>/notes.md`, `<KEY>/card.md` through `ticketPaths`) and the `--labels` file.
- **Writes** only to stdout. No environment variables, network or child processes.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-memory/test/*.test.ts"`
- The script's own test and its invented cards and queries live in `../test/recall-eval/` and `../test/`.
- Whole suite: `npm test`.

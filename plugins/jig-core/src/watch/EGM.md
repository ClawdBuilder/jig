# jig-core/src/watch

## Overview

The watch engine and the `watch` tool. Plugins register a kind of watch (a poll function) and start watches through
`jig().watches`; the engine polls them, saves each one as a small JSON file so a restart of Pi picks it up, and tells the
agent once, with a `jig-watch` follow-up message, when one ends or pauses. Specification:
[watches](../../docs/watches.md); file roles: [code map](../../docs/code-map.md). Parent: [src](../EGM.md).

## Interface

- **`createWatchEngine(options: WatchEngineOptions): WatchEngine`** (`engine.ts`). Only `state.ts` calls it.
  `WatchEngine` extends the contract's `watches` API (`registerKind`, `start`, `list`, `stop`) and adds
  `begin(session)`, `end()` (safe twice), `entries(): WatchEntry[]` and `problem(): string | undefined`.
- **`WatchEngineOptions`**: `now`, `timers?`, `store`, `protect` (`redact` and `mask`), `notify(message, level)`
  (returns whether a screen was there), `emit(WatchDoneEvent)`, `send(WatchMessage)`, `onPoll?`.
- **`WatchEntry`**: `WatchInfo` plus `waiting`, `ageMs` and `describes?`. The docs say `describe`; the field is `describes`.
- **`registerWatchTool(pi, api, engine)`** (`tool.ts`). Only `index.ts` calls it. Tool `watch`, parameters
  `{ action: "list" | "stop", id? }`. `list` classifies as local read, `stop` as local write; any other action is unclassified.
- **`createWatchStore()`** (`store.ts`) returns `{ newId, save, remove, load }`. Types `SavedWatch` (`version: 1`) and
  `WatchStatus` (`open` | `paused` | `done`); `parseSaved(text, id)`.
- **`createOutbox`, `Outbox`, `OutboxOptions`** (`outbox.ts`), `COALESCE_MS = 1000`, `MIN_GAP_MS = 10000`.
- **`composeMessage(notices)`**, `WATCH_MESSAGE_TYPE = "jig-watch"`, `SHOWN_DETAIL_LINES` (10) and `SHOWN_LINKS` (5) (`message.ts`);
  notice events are `finished`, `paused` and `update`.
- **`clean.ts`**: `isWatchResult`, `isWatchUpdate`, `sanitize`, `clip`, `plainLine`, `cleanLine`, `cleanResult`,
  `cleanUpdate`, `Protect`, the `MAX_*` limits and `WITHHELD`. `commands.ts` imports from it.
- **`Timers`, `realTimers`** (`timers.ts`); **`formatAge(ms)`** (`format.ts`).
- Contract types (`WatchKind`, `WatchResult`, `WatchUpdate`, `PollOutcome`, `WatchInfo`, `WatchDoneEvent`) live in
  `../contract-watch.ts` and are re-exported by `../contract.ts`; not here.

## Invariants

- **No timers before a session.** `start()` throws until `begin(session)` has run and after `end()`; Pi forbids timers in
  the factory. All timers are `unref`'d, so print mode can exit with a watch open.
- **Plugin answers are untrusted.** A poll that throws, times out or returns a bad shape is a failed poll, never a crash.
  `done` must pass `isWatchResult`, `update` must pass `isWatchUpdate`, `state` and `spec` are copied through JSON.
- **Poll limits (`engine.ts`).** First poll 2 s after start; a poll lasts at most 60 s (then it is aborted and counts as
  failed); the next delay is clamped to 5 s..10 min and never passes the deadline. Defaults: timeout 60 min, stall 30 min.
- **Ending.** `done` finishes the watch. Past the deadline it finishes as timed out. Three failures in a row pause it.
  `finish()` is idempotent. `stop()` finishes with no agent message; it returns false for an unknown or finished id.
- **An update is told before its `done`**, in the same message, and is not part of the saved result.
- **The stall notice goes to the person only,** once, and is owed (not lost) when no screen was there.
- **Cleaning order is fixed:** sanitize escapes, redact, mask, clip. Summary: one line, 500 characters. Details: 40 lines
  of 1000. Links: 10 of 500, redacted but not masked. If masking throws, the summary is withheld. Cleaning never throws.
  `result.facts` are cleaned by `cleanFacts`: redacted only, at most 50, strings over 64 characters and non-plain values dropped.
- **The agent message shows less than is saved:** a finished watch shows 10 detail lines and 5 links, an update all its details and
  5 links, with "[n more lines/links not shown]" markers; the rest stays in the saved result and the done event.
- **The outbox sends only from its timer,** never inside `add()`. `lastSentAt` is set before `send`, so a failing send
  still spaces the next message; a throwing send loses its items and sets `problem`.
- **Only the owning session polls a watch.** `begin` picks up open and paused watches of this session and leaves other
  sessions' files alone. Finished watches are kept for listing 24 h and deleted from disk after 7 days.
- **Store files are strict.** `parseSaved` accepts only `version: 1` with an id equal to the file name; an unreadable
  file is counted and skipped. Ids are 8 characters of `0123456789abcdefghjkmnpqrstvwxyz`.
- **A failed save is not fatal:** the watch continues in memory and `problem()` reports it.
- **Changing a limit or a field** changes [watches](../../docs/watches.md) in the same commit; `test/watch-*.test.ts` pin them.

## Side Effects

- **Disk.** One file per watch, `<state>/watches/<id>.json` (folder 0700, atomic replace through `replacePrivateFile`),
  written on start, after every poll, on pause and on finish. The state folder is `$JIG_STATE_DIR` (resolved to an absolute path), else
  `${XDG_STATE_HOME:-~/.local/state}/jig`, where a non-absolute `XDG_STATE_HOME` counts as unset (`../paths.ts`). Loading never creates the folder.
- **Clean-up on disk.** Deletes finished files older than 7 days and leftover `<id>.json.<n>.<hex>.tmp` files older than 1 h.
- **No locking** between processes; atomic replace plus session ownership is the protection.
- **Agent message.** `pi.sendMessage({ customType: "jig-watch", ... }, { deliverAs: "followUp", triggerTurn: true })`,
  sent from the outbox timer.
- **Event bus.** `pi.events.emit("jig:watch-done", { id, kind, plugin, title, result })` for every end, a stop included,
  and not for a pause.
- **Screen.** Stall and pause notices call the screen's `notify` at `warning`.
- **Lifecycle.** `index.ts` calls `begin` at session start and `end` on `session_shutdown`. No network, no processes.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/watch-*.test.ts"`
- Docs: `node scripts/check-docs.mjs`

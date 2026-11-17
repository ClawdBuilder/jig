# jig-session/src

## Overview

The code that publishes a live Pi session as one JSON status file, and takes one kind of request file back (switch a tool or a skill, reload when idle). Pi events drive it; any other program reads the files. The format is the contract: [README](../README.md#the-status-file) and [the status file](../docs/status-file.md) specify every field.

## Interface

Entry: `session(options?: SessionOptions): ExtensionFactory` and its `default` export in `index.ts`; also `RELOAD_COMMAND = "session-reload"`. `SessionOptions` extends `Partial<Sources>` with `tickMs` (default 2000; 0 turns the timer off), `onStatus` and `contextHost`, all for tests.

A Pi started as a child (`PI_SUBAGENT_ID` set, or `PI_SUBAGENT_CHILD=1`) registers only the `session` section, so a `jig.json` with
one is not an unknown field there, and writes nothing.

- **Section:** `session` in `jig.json`, registered with a `setup` summary: `compactWhenIdle` (`true`, `false`, or
  `{ afterSeconds, minTokens }`; `afterSeconds` 60..290, default 270; `minTokens` at least 1,000, default 150,000). Off by default,
  and `idle-compact.ts` holds the parser, the check and the timer.
- **Commands:** `/session-file` (where the file is and which terminal it names), `/context` (the breakdown in the terminal, through `buildReport` and `showContext`), `/session-reload` (waits for idle, then `ctx.reload()`).
- **Pi hooks:** `session_start`, `session_shutdown`, `agent_start`, `agent_settled`, `turn_end`, `model_select`, `thinking_level_select`, `session_compact`, `session_tree`, `tool_call`, `tool_execution_start`, `tool_execution_end`, `before_agent_start`; and `jig-core`'s `JIG_EVENTS.decision` on the event bus.
- **Status file** (`status.ts`): `StatusFile` (`start`, `stop(reload)`, `refresh`, `tick`, `write`, `setBusy`, `takeRequest`, `snapshot`, `path`, `requestPath`), `SCHEMA = 1`, `SessionStatus`, `Sources`, `terminalOf`, `TERMINAL_VARIABLES` (`HC_TERMINAL_ID`, `WEZTERM_PANE`, `KITTY_WINDOW_ID`, `TMUX_PANE`, in that order).
- **Files** (`files.ts`): `stateDir`, `sessionsDir`, `fileName` (unsafe characters become `_`, at most 120), `writeAtomic`, `removeFile`, `running`, `sweep`.
- **Activity** (`activity.ts`): `Activity` records `Output` (files from successful `edit` and `write` calls, merged by path with the active ticket's folder files from `ticketFiles`: notes, plans, reports, up to 200, marked `edited`) and `Recent` (tool, action, decision, answer, outcome); `MAX_OUTPUTS` 50 per kind, `MAX_RECENT` 15.
- **Ticket and workflow** (`ticket.ts`): `activeTicket`, `ticketsFolder`, `readTicket`, `readWorkflow`, `workflowFolders`, `ticketFiles`, `jiraUrl`, `TICKET_ENTRY = "jig-memory-ticket"`.
- **Usage** (`usage.ts`): `sumUsage`, `sessionUsage`, `contextFill`.
- **Idle compaction** (`idle-compact.ts`): `parseSession`, `validateSessionSection`, `idleCompactionOf`, `idleCompactionLine`,
  `idleCompact(pi, options)`, `IdleCompaction`, `MIN_AFTER_SECONDS` (60), `MAX_AFTER_SECONDS` (290), `DEFAULT_AFTER_SECONDS` (270),
  `DEFAULT_MIN_TOKENS` (150,000), `MIN_MIN_TOKENS` (1,000).
- **Context and requests** (`context.ts`, `breakdown.ts`, `context-command.ts`, `requests.ts`): `ContextView`, `compose`, `parsePrompt`, `reserveFrom`, `buildReport`, `reportLines`; `parseRequest`, `takeRequest`, `Switches`, `REQUEST_SCHEMA = 1`, `MAX_REQUEST_BYTES` (64 KiB), `SWITCHES_ENTRY = "jig-session.switches"`, `requestsDir`.

## Invariants

- **The status file is a published contract.** `SCHEMA` is `1`: add a field freely, but removing, renaming or changing the meaning of one needs `schema: 2` and an entry in `docs/decisions.md`. Update the README table and `docs/status-file.md` in the same commit; `docs/contracts.md` lists the file as a pinned contract.
- **Files only.** No port, no network, no folder but `<state>/sessions` and `<state>/requests`. The switches live in a session entry (`appendEntry`).
- **No values.** A tool call is written as tool and action names, a file as its path. Never write an argument value, a command line or a secret. `Activity` clips names to a strict pattern.
- **Atomic writes.** A file is written to a temp file and renamed (`writeAtomic`), folders 0700, files 0600. Write only when the content changed (`last`).
- **A request approves nothing.** It can switch tools or skills of this session or reload; `jig-core` still decides every call. Unknown names are ignored and named in the answer, a hidden tool cannot be turned on, and a request over 64 KiB is refused unread.
- **A request is taken by rename,** so a newer one is never lost.
- **Idle compaction is off by default and never surprises.** It runs only in `tui` and `rpc` modes, only after `agent_settled`
  with no abort, and only when the session is still idle with nothing pending, an empty editor and at least `minTokens` of context;
  one timer per idle stretch, cancelled by the next input, turn, tool call or prompt. A failure is a warning line, never a crash.
- **Handlers never throw into Pi.** A throwing `tool_call` handler blocks the call, so `tool_call` only notes a path and swallows errors; the other reads are guarded.
- **Cleanup:** the file and the request file go on shutdown, except for a reload, which keeps them and the last answer. Files of a dead `pid` are swept at the next start.
- **Read-only toward other plugins.** `ticket.ts` only reads what `jig-memory`, `jig-workflow` and `jig-jira` own (files up to 1 MiB; the ticket folder is re-read every 10 s). It repeats their folder rules and imports no module of theirs.
- **Imports:** from `jig-core` `client.ts`, `contract.ts` and `kit/jig-messages.ts` (`MESSAGE_LABELS`, in `context-command.ts`); from Pi `getAgentDir` and types, and from `@earendil-works/pi-tui` `Key`, `matchesKey` and `truncateToWidth`.

## Side Effects

- **Disk write:** `<state>/sessions/<session>.json` and `<state>/requests/<session>.json` handling; temp files `*.tmp` and `*.taking` beside them. The state dir is `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`.
- **Disk read:** the ticket folder (`notes.md`, `workflow.json`, a file listing), workflow files from the configured folders, `<agentDir>/workflows` and, for a trusted project, `.pi/workflows`. The session's transcript comes through Pi's session manager (`getBranch`), not from disk.
- **Timer:** a 2 s `setInterval` (unref'd) that takes a request, notices a new ticket or tool set, and writes when something changed;
  plus one idle-compaction `setTimeout` while a session waits, cancelled by the next activity.
- **Pi:** `setActiveTools`, `appendEntry`, `sendUserMessage("/session-reload")`, `ctx.reload()` and `ctx.compact()`; events listened to as above.
- **Env read:** `JIG_STATE_DIR`, `XDG_STATE_HOME`, `XDG_DATA_HOME`, the terminal variables, `PI_SUBAGENT_ID`, `PI_SUBAGENT_CHILD`. Config sections read through `jig-core`: `memory`, `workflow`, `jira` (`site` only).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-session/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.

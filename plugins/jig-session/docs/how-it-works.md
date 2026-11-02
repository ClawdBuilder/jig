# How it works

How `jig-session` turns Pi's events into a status file, how a reader's switch travels there and back, which source file does
each step, and what it is built on. It is written for a reader new to TypeScript and to Pi's extensions. The format itself is
specified in the [jig-session overview](../README.md#the-status-file).

## The words used here

- **Pi** is the coding agent. It runs in a terminal and loads **extensions**: TypeScript files that it calls on its
  **events**, such as "a turn ended" or "a tool call starts".
- **An extension's factory** is the function the file exports. Pi calls it once with `pi`, the extension API: `pi.on(event,
  handler)` subscribes to an event, and calls such as `pi.setActiveTools()` change the session.
- **A prompt and a turn.** Your prompt starts a run of the agent; a run is one or more **turns**, each one request to the
  model and the tool calls it asks for.
- **The state dir** is jig-core's folder for state: `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`.
- **A reader** is any program that reads the status files, such as the Work and Context panels of the
  [Herdr app files](../../../herdr/README.md).

## Writing the status file

![On the agent's machine, Pi tells jig-session about its events and jig-session writes sessions/<id>.json by a rename; on your computer, the Herdr app's Work and Context panels run one sh script on that machine through Herdr's exec every 2 seconds while shown](../../../docs/img/session-file.svg)

*One file, two machines. Only jig-session writes the file; a reader polls it, here through Herdr's `exec` on the agent's
machine.*

1. **Pi loads the extension.** `index.ts` hands on to `src/index.ts`, whose factory `session()` subscribes to the events. A
   child Pi started by `jig-agents` returns at once and writes nothing.
2. **The session starts** (`session_start`). `StatusFile.start()` removes files whose Pi no longer runs (`sweep`), names this
   session's file, brings back saved switches, makes the `requests/` folder and writes the file. It starts a 2-second timer.
3. **Pi works.** Each event updates one part and calls `write()`: a tool call starts or ends (`recent`), an `edit` or `write`
   succeeds (`outputs`), jig-core decides (`jig:decision`), a turn ends or the model changes (everything, read again).
4. **`write()` writes only a change.** It builds the whole status, compares its JSON with the last one written, and when they
   differ writes a temporary file and renames it over the old one. A rename is one step, so a reader never sees half a file.
5. **The timer ticks** every 2 seconds: it takes a request file if there is one, notices a new ticket or tool set, and writes
   if anything changed. The ticket folder is read again every 10 seconds at most.
6. **The session ends** (`session_shutdown`). The status file and the request file are removed. A reload keeps both, so
   the Pi that comes back finds its last answer.

**Outputs and repositories.** For each successful `edit` or `write`, `Activity.repoOf()` walks up from the file's folder to
the nearest folder holding `.git` (a folder, or a file as a worktree has) and stores it as `repo`, or `null` outside any
repository. It looks at the file system only; it never runs git.

## A switch, there and back

![The Context panel writes a request file; jig-session takes it by rename every 2 seconds, calls setActiveTools, filters skills in before_agent_start, saves the switches with appendEntry, reloads when idle if asked, and answers in lastRequest, which the panel reads](../../../docs/img/session-switch.svg)

*The numbers match the steps below. Nothing in the round trip approves a call.*

1. **The reader writes the request.** The Context panel runs one `sh` on the agent's machine:
   `printf %s "$2" > "$1.tmp" && mv "$1.tmp" "$1"`, with `requests/<file name>.json` and the JSON as arguments.
2. **jig-session takes it.** On its next tick, `takeRequest()` renames the file to a name of its own, reads it (64 KiB at
   most) and removes it. A request is handled once; one written meanwhile is a new file, taken at the next tick.
3. **Tools.** `Switches.apply()` builds the new active set and calls `pi.setActiveTools()`. Pi sends the new tool list with
   its next request to the model; a request already sent is untouched. Each tool is checked afterwards; one Pi kept is named.
4. **Skills.** A skill switched off goes into a set. At your next prompt Pi fires `before_agent_start` with a copy of the
   prompt options, and `filterSkills()` removes those skills from its list, so the model no longer sees them. This session only.
5. **Saved.** When anything changed, `pi.appendEntry("jig-session.switches", …)` adds an entry to the session. After a reload
   or a resume, `Switches.restore()` reads the last such entry and applies it again.
6. **Reload, if asked.** When Pi is idle, jig-session calls `pi.sendUserMessage("/session-reload")`, which runs its own command;
   the command waits for idle and calls `ctx.reload()`. When Pi is busy, it waits for `agent_settled`.
7. **The answer.** The outcome goes into the status file as `lastRequest`: `{ id, ok, message, at, reload? }`.
8. **The reader sees it.** The panel reads the status files every 2 seconds and, when `lastRequest.id` is the id it sent,
   draws the switch as settled.

**What a request cannot do.** Approve a call, answer a question, or change jig-core's rules. Turning a tool on only declares
it to the model: jig-core still decides each call, so a denied call stays denied. Refusals and edge cases are in
[Context and requests](context.md#requests).

## Reading the source

Read in this order. Each file is short; the tests in `test/` show each one used.

| File | What it does | Who calls it |
|---|---|---|
| `index.ts` | The entry Pi loads; hands on to `src/index.ts` | Pi |
| `src/index.ts` | The factory: subscribes to events, registers `/session-file` and `/session-reload` | Pi, once per load |
| `src/status.ts` | `StatusFile`: start, stop, the 2 s tick, the snapshot and the write | the event handlers |
| `src/files.ts` | The state dir, file names, the atomic write, the sweep of dead sessions | `status.ts` |
| `src/activity.ts` | `outputs` (with `repo`) and `recent`, from tool events and decisions | `index.ts`, `status.ts` |
| `src/ticket.ts` | The active ticket, its title, and the workflow's stages, read from files | `status.ts` |
| `src/usage.ts` | Tokens and cost for the session; how full the context is | `status.ts`, `context.ts` |
| `src/context.ts` | `ContextView`: the context detail, the request poll, the skill filter, the reload | `index.ts`, `status.ts` |
| `src/breakdown.ts` | Pure counting: the prompt split into parts, characters to tokens | `context.ts` |
| `src/requests.ts` | The request file: parse, take by rename, sweep; `Switches` apply, save, restore | `context.ts`, `status.ts` |

**One event followed through.** A `write` call ends: Pi fires `tool_execution_end` → `index.ts` calls
`status.activity.ended()` (`activity.ts` adds the path to `outputs`, with its `repo`) → `status.write()` (`status.ts`
builds the snapshot) → `writeAtomic()` (`files.ts` writes the temporary file and renames it).

## Built on

Nothing outside Pi, jig-core and Node.js: `jig-session` has no npm dependency of its own.

- **Pi's events:** `session_start`, `session_shutdown`, `agent_start`, `agent_settled`, `turn_end`, `model_select`,
  `thinking_level_select`, `session_compact`, `session_tree`, `tool_call`, `tool_execution_start`, `tool_execution_end`,
  and `before_agent_start` for the skills.
- **Pi's extension API:** `pi.setActiveTools`, `getActiveTools`, `getAllTools`, `getCommands`, `getSettings`,
  `getThinkingLevel`, `appendEntry`, `sendUserMessage`, `registerCommand`; `getAgentDir()` from the package.
- **Pi's context (`ctx`):** `sessionManager.getSessionId` and `getBranch`, `getContextUsage`, `getSystemPrompt`, `isIdle`,
  `isProjectTrusted`, `model`, `cwd`; in a command, `waitForIdle` and `reload`.
- **jig-core:** the `jig:decision` event on `pi.events`, and `jig().config.section()` for the `memory`, `workflow` and `jira`
  sections, through its `client.ts` and `contract.ts` only.
- **Node.js built-ins:** `node:fs` (write, rename, remove, list, stat), `node:crypto` (random temporary names), `node:os`
  and `node:path`; `process.kill(pid, 0)` to tell a live Pi; a `setInterval` timer that does not keep Pi running (`unref`).

[Back to the overview](../README.md)

# jig-session: the live session's state, as a file other programs read

**Status: built.** One small JSON status file per session, tested with a stand-in and seen in a real Pi session.

<img src="../../docs/assets/jig.svg" width="48" alt="Jig logo: a set-square">

`jig-session` is a Pi extension that publishes what a Pi session is doing as one small JSON file per session: its terminal,
model, context and what fills it, cost, ticket and workflow stage, the files it created or changed, and its recent tool calls
with jig-core's decision on each. Any program can read it, such as a side panel or a script; Pi opens no port for it.

A reader may also send one kind of request, through a file: turn a tool or a skill on or off for this session, or reload
Pi when it is idle. The session answers in its status file. A request never approves a call.

For example, a session in a herdr-core terminal writes `~/.local/state/jig/sessions/<session id>.json` with
`"terminal": "t7"`, and the Work panel of Jig's [Herdr app files](https://github.com/ClawdBuilder/jig-herdr) shows it while that terminal has the focus.

## How it works

Pi calls the extension on its events (start, each turn, each tool call, a model change, shutdown); it writes the file when
the content changed. Readers poll: the Herdr panels every 2 seconds, while on screen, from another machine if need be.

![On the agent's machine, Pi tells jig-session about its events and jig-session writes sessions/<id>.json by a rename; on your computer, the Herdr app's Work and Context panels run one sh script on that machine through Herdr's exec every 2 seconds while shown](../../docs/img/session-file.svg)

*One file, two machines. jig-session writes on the agent's machine; the Herdr panels read it there through Herdr's `exec` with
`on`, every 2 seconds while they are on screen, and never write it.*

![The Context panel writes a request file; jig-session takes it by rename every 2 seconds, calls setActiveTools, filters skills in before_agent_start, saves the switches with appendEntry, reloads when idle if asked, and answers in lastRequest, which the panel reads](../../docs/img/session-switch.svg)

*A switch, there and back. The request changes what the model is offered (tools from its next request, skills from your
next prompt); jig-core still decides every call. Step by step, with the source files, in [How it works](docs/how-it-works.md).*

## The status file

`<state dir>/sessions/<session id>.json`, where the state dir is jig-core's: `$JIG_STATE_DIR`, else
`${XDG_STATE_HOME:-~/.local/state}/jig`. The folder has mode 0700 and each file 0600. The session id is made safe as a file
name: characters other than letters, digits, `.`, `-` and `_` become `_`.

This is the contract, **schema 1**. A field may be added without a new schema number; removing or renaming one, or changing
its meaning, needs `schema: 2` and a [Decisions](../../docs/decisions.md) entry.

| Field | Type | Holds |
|---|---|---|
| `schema` | `1` | The version of this format |
| `session` | string | Pi's session id |
| `pid` | number | Pi's process id; a reader checks it still runs |
| `cwd` | string | Pi's working folder |
| `terminal` | string or null | The terminal Pi runs in, as its host names it (`t7`, `%3`) |
| `terminalFrom` | string or null | The variable that named it: `HC_TERMINAL_ID`, `WEZTERM_PANE`, `KITTY_WINDOW_ID` or `TMUX_PANE` |
| `agentDir` | string | Pi's agent folder |
| `model` | object or null | `{ provider, id, name }` |
| `thinking` | string or null | The thinking level, such as `medium` |
| `state` | string | `busy` while the agent works, else `idle` |
| `context` | object | `{ tokens, window, percent }`, each a number or null |
| `usage` | object | `{ input, output, cacheRead, cacheWrite, cost }` for the session; `cost` null when a call had no price |
| `tools` | object | `{ active, total }`: tools declared to the model, and registered |
| `ticket` | object or null | `{ key, title?, url? }` |
| `workflow` | object or null | `{ name, stages, current, since?, prs, problem? }` |
| `outputs` | list | `{ path, action, at, repo }`, newest first, one per path; up to 50 with `repo` null and up to 50 with a repo. Built from the successful `edit` and `write` calls in the session's transcript (so a resumed or restarted session keeps them) and the live ones, plus the active ticket's user-facing files (notes, plans, other `.md`, `.txt` and `.json` reports, and `evidence/` except the tool outputs Jig saves there by itself, two levels deep; never `ticket.json`, `workflow.json` or `history/`), with the file's modification time as `at`. The newest `at` wins per path; the ticket folder is re-read every 10 s |
| `recent` | list | The last 15 tool calls, newest first: `{ at, tool, action?, decision?, answer?, outcome }` |
| `contextDetail` | object or null | What fills the context, part by part, and the tools, skills and context files behind it |
| `lastRequest` | object or null | `{ id, ok, message, at, reload? }`: the answer to the last request |
| `startedAt`, `updatedAt` | string | ISO times |

[The status file](docs/status-file.md) says when it is written, shows an example, how to read it safely and
[each field in detail](docs/status-file.md#fields-in-detail).

## Requests

`<state dir>/requests/<file name of the session>.json`, next to `sessions/`: the same name as the status file. A reader
writes it to a temporary file and renames it over this name. The session looks every 2 seconds, takes the file and answers
in `lastRequest`. The switches are kept in the session (a `jig-session.switches` entry), so a reload or a resume keeps
them. **Schema 1:**

```json
{ "schema": 1, "id": "ctx-1", "tools": { "bash": false }, "skills": { "pdf-tools": false }, "reload": true }
```

- **`tools`:** each name on (`true`) or off, with `pi.setActiveTools()`, from the model's next request. A hidden tool cannot be turned on.
- **`skills`:** each name on or off for this session only: a skill off is left out of the skills list from your next prompt.
- **`reload`:** runs `/session-reload` (Pi's reload) once the agent is idle.
- **Anything else:** a name the session does not have is ignored and named in the answer; an unknown field is ignored.

## Commands

| Command | What it does |
|---|---|
| `/context` | Shows what fills the context: a grid, each part, the tools by plugin and Jig's own messages |
| `/session-file` | Says where this session's status file is, and the terminal it names |
| `/session-reload` | Reloads Pi once the agent is idle; a reader's `reload` request runs it |

## Rules

- **Files only.** It writes its own status files and takes its request files: no port, no network, no other folder. The
  switches are kept as an entry in the session, through Pi.
- **No values.** A tool call is written as its tool and action names, a file as its path. No argument value, no command
  line, no secret.
- **One step.** A file is written to a temporary file and renamed over the old one, so a reader never sees half of one.
- **A request approves nothing.** It can switch a tool or a skill of this session, or reload it. jig-core's rules still
  decide every call, so a tool turned on is as allowed or denied as before.
- **Its own life.** The file goes when the session ends (a reload keeps it); files left by a Pi that crashed are removed at the next start.
- **No child files.** A child Pi that `jig-agents` started writes nothing: it runs in its parent's terminal.

- **`jig-core`:** `recent` takes each call's decision from the `jig:decision` event; its rules decide every call.
- **`jig-memory`, `jig-workflow`, `jig-jira`:** read only, for `ticket` and `workflow`.
- **Readers:** any program that can read the folder, on this machine or through a link to it, as the
  [Herdr app files](https://github.com/ClawdBuilder/jig-herdr) do for their Work and Context panels.

## Configure

Nothing. The folder follows `$JIG_STATE_DIR`, as jig-core's does. The ticket folder and the workflow folders are read from
the `memory` and `workflow` sections, and the Jira address from the `jira` section's `site`, as those plugins read them.

## Company part (in the company plugin)

None. Nothing here is specific to a company.

## Layout

- `index.ts`: the entry Pi loads; it hands on to `src/index.ts`.
- `src/`: the implementation, its checks and the parts it runs on.
- `skills/`: none: the tool text is the entry.
- `test/`: the unit tests, fake hosts and real-program tests.

## More detail

**Use it**
- [How it works](docs/how-it-works.md): Read before you change the file.
- [The status file](docs/status-file.md): Read before you read the file.
- [Front-end contracts](../../docs/contracts.md): Read before you change a contract.
- [Context and requests](docs/context.md): Read before you change context.

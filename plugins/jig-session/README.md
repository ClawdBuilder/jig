<img src="../../docs/assets/jig.svg" width="48" alt="Jig logo: a set-square">

# jig-session: the live session's state, as a file other programs read

**Status: built.** Tested with a stand-in for Pi, and seen working with Pi 1.4.0 in a real session in WSL, read by the Work
panel of the [Herdr app files](../../herdr/README.md). Not tried: macOS, Windows without WSL.

`jig-session` publishes what a Pi session is doing as one small JSON file per session: its terminal, model, context and what
fills it, cost, ticket and workflow stage, the files it created or changed, and its recent tool calls with jig-core's decision
on each. Any program can read it: a side panel, a status bar, a script. Nothing has to ask Pi, and Pi opens no port for it.

A reader may also send one kind of request, through a file: turn a tool or a skill on or off for this session, or reload
Pi when it is idle. The session answers in its status file. A request never approves a call.

For example, a session in a terminal that herdr-core runs writes `~/.local/state/jig/sessions/<session id>.json` with
`"terminal": "t7"`, and a panel shows the session whose terminal has the focus. One such reader is Jig's
[Herdr app files](../../herdr/README.md).

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
| `outputs` | list | Up to 50 `{ path, action, at }`, newest first, one per path |
| `recent` | list | The last 15 tool calls, newest first: `{ at, tool, action?, decision?, answer?, outcome }` |
| `contextDetail` | object or null | What fills the context, part by part, and the tools, skills and context files behind it |
| `lastRequest` | object or null | `{ id, ok, message, at, reload? }`: the answer to the last request |
| `startedAt`, `updatedAt` | string | ISO times |

What each field holds in detail is in [The status file](docs/status-file.md#fields-in-detail).

[The status file](docs/status-file.md) says when it is written, shows an example and says how to read it safely.

## Requests

`<state dir>/requests/<file name of the session>.json`, next to `sessions/`: the same name as the status file. A reader
writes it to a temporary file and renames it over this name. The session looks every 2 seconds, takes the file and answers
in `lastRequest`. **Schema 1:**

```json
{ "schema": 1, "id": "ctx-1", "tools": { "bash": false }, "skills": { "pdf-tools": false }, "reload": true }
```

- **`tools`:** each name on (`true`) or off from the next turn, with `pi.setActiveTools()`. A hidden tool cannot be turned on.
- **`skills`:** each name on or off for this session only: a skill off is left out of the skills list of every later turn.
- **`reload`:** runs `/session-reload` (Pi's reload) once the agent is idle.
- **Anything else:** a name the session does not have is ignored and named in the answer; an unknown field is ignored.

The switches are kept in the session (a `jig-session.switches` entry), so a reload or a resume keeps them.

## Commands

| Command | What it does |
|---|---|
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
- **Its own life.** The file goes when the session ends; files left by a Pi that crashed are removed at the next start.
- **No child files.** A child Pi that `jig-agents` started writes nothing: it runs in its parent's terminal.

## Configure

Nothing. The folder follows `$JIG_STATE_DIR`, as jig-core's does. The ticket folder and the workflow folders are read from
the `memory` and `workflow` sections, and the Jira address from the `jira` section's `site`, as those plugins read them.

## How it fits with the other plugins

- **`jig-core`:** `recent` takes each call's decision from the `jig:decision` event.
- **`jig-memory`, `jig-workflow`, `jig-jira`:** read only, for `ticket` and `workflow`.
- **Readers:** any program on the same machine. Jig's [Herdr app files](../../herdr/README.md) read it for their Work panel.

## Company part (in the company plugin)

None. Nothing here is specific to a company.

## Layout

```text
jig-session/
  src/   index.ts (the factory, the commands), status.ts (the file and when it is written), activity.ts (outputs and
         recent calls), ticket.ts (ticket and workflow), usage.ts (context and cost), files.ts (folder, atomic write, sweep),
         context.ts (the context detail and requests), breakdown.ts (the counting), requests.ts (the request file, switches)
  test/  the file written, updated and removed; outputs, recent calls, ticket and workflow; the atomic write; the breakdown,
         requests, switches and reload
  docs/  status-file.md, context.md
```

## More detail

- [The status file](docs/status-file.md): when it is written, an example, and how a reader finds the session it wants
- [Context and requests](docs/context.md): how the breakdown is counted, how a request is handled, skills and reload

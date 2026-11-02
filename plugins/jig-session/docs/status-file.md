# The status file

When `jig-session` writes a session's status file, what one looks like, and how a program that reads it finds the session
it wants. The fields are specified in the [jig-session overview](../README.md#the-status-file).

A reader cannot ask Pi anything: nothing listens on a port. It lists the folder and reads the files, as often as it shows
them. The files are small, a few kilobytes.

## When it is written

| Moment | What changes |
|---|---|
| Session start | The file is made; files of Pis that no longer run are removed |
| A tool call starts or ends | `recent`, and `outputs` after an `edit` or `write` that succeeded |
| jig-core decides on a call (`jig:decision`) | That call's `decision` and `answer` |
| After each turn, a compaction, a model change, a move in the session tree | Everything, with the totals read again |
| The agent starts or settles | `state` |
| The thinking level changes | `thinking` |
| Every 2 seconds | A check: a request is taken; a new ticket (`/ticket`), tool set or state is written; the ticket folder is read every 10 s |
| A request is taken | `lastRequest`, and the tools or skills it switched |
| Session shutdown | The file is removed, and the request file; a reload keeps both |

A write happens only when the content changed, so `updatedAt` is the time of the last change.

## An example

```json
{
  "schema": 1,
  "session": "0193f2c4-7a1e-7c6b-9d2e-4f0a1b2c3d4e",
  "pid": 41873,
  "cwd": "/work/orders-api",
  "terminal": "t7",
  "terminalFrom": "HC_TERMINAL_ID",
  "agentDir": "/home/ann/.pi/agent",
  "model": { "provider": "acme", "id": "model-1", "name": "Model One" },
  "thinking": "medium",
  "state": "idle",
  "context": { "tokens": 25485, "window": 200000, "percent": 12.7 },
  "usage": { "input": 14, "output": 481, "cacheRead": 74248, "cacheWrite": 50449, "cost": 0.14 },
  "tools": { "active": 23, "total": 29 },
  "ticket": { "key": "PROJ-123", "title": "Fix the login", "url": "https://example.atlassian.net/browse/PROJ-123" },
  "workflow": {
    "name": "feature",
    "stages": [{ "id": "understand", "goal": "Read the ticket" }, { "id": "plan" }, { "id": "build" }],
    "current": "plan",
    "since": "2026-01-02T09:58:00.000Z",
    "prs": []
  },
  "outputs": [{ "path": "/work/orders-api/src/login.ts", "action": "edited", "at": "2026-01-02T10:04:31.000Z" }],
  "recent": [{ "at": "2026-01-02T10:04:31.000Z", "tool": "edit", "decision": "allow", "outcome": "ok" }],
  "contextDetail": {
    "window": 200000, "used": 25485, "usedFrom": "pi", "reserve": 16384, "free": 158131,
    "parts": { "messages": 9230, "tools": 11800, "system": 1900, "skills": 1450, "contextFiles": 1105 },
    "tools": [{ "name": "read", "on": true, "tokens": 164 }, { "name": "bash", "on": false, "tokens": 992 }],
    "skills": [{ "name": "pdf-tools", "on": true, "tokens": 84, "listed": true }],
    "files": [{ "path": "/work/orders-api/AGENTS.md", "tokens": 1080 }]
  },
  "lastRequest": { "id": "ctx-1", "ok": true, "message": "bash off", "at": "2026-01-02T10:04:20.000Z" },
  "startedAt": "2026-01-02T09:55:12.000Z",
  "updatedAt": "2026-01-02T10:04:31.120Z"
}
```

## Reading it

1. **List `<state dir>/sessions/*.json`** and skip files ending in `.tmp`: those are writes in progress.
2. **Check `schema`.** A reader made for schema 1 skips a file with another number.
3. **Check `pid`.** A Pi that was killed leaves its file until the next session starts; `kill -0 <pid>` tells a live one.
4. **Pick the session.** A terminal host compares `terminal` with its own focused terminal, when `terminalFrom` is its own
   variable. herdr-core sets `HC_TERMINAL_ID` (`t7`); in the Herdr app a terminal on another machine is `<machine>/t7`. With
   no match, the session updated last is a fair default.

A reader never writes to this folder. To ask the session for something it writes the request file in `requests/`, as
[Context and requests](context.md#requests) says. The file shows decisions; approving a call happens in Pi, inside the
waiting call.

[Back to the overview](../README.md)

## Fields in detail

- **`terminal`:** the first of the four variables that is set, in that order (a host may run inside tmux). Each host names
  terminals its own way, so a reader compares `terminal` only when `terminalFrom` is its own host's variable.
- **`ticket`:** the key `/ticket` set (`jig-memory`). `title` is the text after the key on the first line of the ticket's
  `notes.md`; `url` is `<jira.site>/browse/<key>` when the `jira` section has a `site`.
- **`workflow`:** from the ticket's `workflow.json` (`jig-workflow`). `stages` are `{ id, goal? }` in order; `problem` says when
  the workflow file is missing. `prs` are its readings, one per repository: `{ repo, branch?, number?, state?, draft?, url?,
  checks?: { pass, fail, pending, total }, at?, error? }`.
- **`outputs`:** absolute paths of successful `edit` and `write` calls; `action` is `created` for a `write` to a new file,
  else `edited`.
- **`recent`:** `decision` is jig-core's `allow`, `ask` or `deny`, `answer` your reply when it asked (`allow`,
  `allow-session`, `decline`). `outcome` is `running`, `ok`, `error`, or `blocked` when denied or declined.
- **`contextDetail`:** `{ window, used, usedFrom, reserve, free, parts, tools, skills, files }`. `parts` holds `messages`,
  `tools`, `system`, `skills` and `contextFiles` in tokens; [Context and requests](context.md) says how each is counted.

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
| Every 2 seconds | A check: a new ticket (`/ticket`), tool set or state is written; the ticket folder is read every 10 s |
| Session shutdown | The file is removed |

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

A reader never writes to this folder. The file shows decisions; approving a call happens in Pi, inside the waiting call.

[Back to the overview](../README.md)

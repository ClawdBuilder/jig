# The web page

`/lens web` opens a page of charts and tables over the index, served by the Pi
session you are in, so you can see cost, sessions, tools and your waiting time
without installing Grafana. Back to the [jig-lens overview](../README.md).

## What each view answers

| View | Questions it answers |
|---|---|
| Overview | What did today, the last 7 or the last 30 days cost; how many tokens, turns, calls and failures |
| Overview, per day | Which day cost the most (bars, one per day) |
| Overview, tables | Which session and which ticket cost the most, failed most, or waited for you longest |
| Tickets | Which tickets had work in the range; type a key to open any ticket |
| Ticket | Every session of one ticket, over all time: cost, duration, tools used, failures, waits |
| Session | Every turn and call in order, with child agents nested under the session that started them, a lane timeline of where the time went, and a panel with one call's arguments and result |
| Tools | Calls, failures and p50 and p95 duration per tool; calls refused, by who decided and why |
| Tools, loops | Where the agent tried the same failing thing 3 times or more in a row |
| Your time | Questions asked, how you answered, the total, median and longest waits, by tool and ticket |

- **Ranges:** today, the last 7 days or the last 30, as days on your clock, as
  in the summary. A ticket's page covers all time.
- **Every table sorts** when you click a column, and a session or ticket
  anywhere opens its own view.
- **Where the time went** draws each turn as one bar in three lanes: model time, tool time, and the time waiting for
  you. A turn runs from its start to the next turn's start; its calls give the tool and waiting times, and the rest of the
  interval is the model's. Calls of a child agent are in the child's own lanes, so a child never counts twice.
- **One call's text** opens when you click a call in the session timeline: a panel beside the page shows the arguments
  and the result, read from Pi's own session file for that session alone. The file holds what `jig-core` masked at
  `tool_result`, so the text shown is the masked text; it is cut at 20,000 characters, only that one call is read, and the
  panel goes away with the page. Nothing is copied into the index.
- **The session timeline** shows, for a call: the tool and action, where it
  acted, the decision and who made it, your answer and how long it waited, the
  outcome with its error kind and line, the duration and the facts. For a turn:
  the model, tokens in (with the cached share) and out, and the cost.
- **A model is shown by name,** from the same names `/lens usage` uses (sent
  by another plugin on the `jig-lens:model-names` event). A model nobody named
  is shortened: an ARN to its service and last part (`llm abc123`), so no
  account number is shown; the full id is only in the tooltip.
- **A child agent** (one whose records name this session as its parent) is a
  block at the time it started, with its role, and its own children inside.
- **A loop** is one tool and action failing, or being blocked, at least 3 times
  in a row within a session. Its other calls in between do not break the run; a
  call of that tool and action that went well does.
- **Stages and compactions** are not in the records yet, so the page does not
  show them.

The page follows the system's light or dark setting, with the `jig-paper` and
`jig-signal` colours, and fits a laptop screen without sideways scrolling. Each
view says so when it has nothing to show.

## How it starts and stops

- **`/lens web`** imports the new lines, as `/lens` does, then starts the page
  on a free port of `127.0.0.1` and opens it with `$BROWSER`, else `xdg-open`,
  else `open` on macOS. It says the address either way.
- **A second `/lens web`** in the same session reuses the running page and
  opens it again.
- **`/lens status`** ends with a line that says whether the page runs, and at
  which address.
- **When Pi exits,** the page stops: it is part of the session, not a process
  of its own. Each session has its own page and port.

It takes a free port rather than `port` from `jig.json`, which belongs to
Grafana or Datasette: they can run at the same time.

The page reads the index each time it asks, so ↻ (or a reload) shows what the
end of the latest run imported.

## The endpoints

All answer `GET` only, with JSON. With no index yet, each answers
`{ "empty": true }`.

| Path | What it returns |
|---|---|
| `/api/overview?days=N` | The totals, cost per day, and the tables by session and by ticket |
| `/api/tickets?days=N` | The tickets with lines in the range |
| `/api/ticket?key=KEY` | One ticket's totals and its sessions, each with the tools it used |
| `/api/session?id=ID` | One session's totals and timeline, with child agents nested |
| `/api/tools?days=N` | Each tool's calls, failures and durations; the refused calls; the loops |
| `/api/time?days=N` | The questions, answers and waits, by tool and ticket, and the longest |

`days` is 1 to 90; anything else is 1. A table holds at most 200 rows, and a
timeline at most 5000 lines. The queries are in `src/web-queries.ts`; the
totals reuse the summary's own, from `src/queries.ts`.

## Security

The agent's shell can reach `127.0.0.1` too, and the records may hold what the
sandbox hides from the agent. So the page is local, read-only and closed to
anyone without its link:
- **`127.0.0.1` only.** The server listens on no other address.
- **A secret link.** The address `/lens web` opens carries a random secret once.
  The server swaps it for a cookie that scripts cannot read, and answers nothing
  without it. The secret is new for each session.
- **The right host name.** A request for another name than `127.0.0.1` or
  `localhost` is refused, so another web site cannot reach it by DNS rebinding.
- **Read-only.** Only `GET` is served, and the index is opened read-only for
  each request. There is no endpoint that takes SQL: the page asks only the
  fixed questions above.
- **Nothing from elsewhere.** The page is one file with its own styles and
  script; it loads no font, script or picture, and its content security policy
  lets it talk to its own server only.
- **Text stays text.** Error lines and names from the records are set as text,
  never as markup.

The link can show up in the browser opener's arguments, as `jig-review`'s does;
the page approves nothing, so the link only lets someone read the figures.

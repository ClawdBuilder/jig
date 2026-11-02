# Viewers

The ways to look at the index beyond the `/lens` summary: the built-in page by
default, and Grafana or Datasette as optional extras. Back to the
[jig-lens overview](../README.md).

**The everyday view is `/lens` inside Pi:** a summary with no server and no
install. **For charts and drill-down, `/lens web`** opens a page that this Pi
session serves on `127.0.0.1`, with nothing to install (see
[The web page](web.md)).

Grafana is an optional extra (`/lens grafana`) for those who already run it or
want to write their own dashboards, and Datasette (`/lens datasette`) shows the
kept queries as tables. How each is run is in [Viewer settings](viewer-settings.md),
and what `/lens grafana` does step by step is in
[Starting Grafana](starting-grafana.md).

## Grafana's dashboards

Five dashboards, in a Grafana folder named Jig. A day is a UTC day, as in the
record files.

| Dashboard | Questions it answers |
|---|---|
| Overview | Cost per day, model, agent role, ticket and session; cache hit rate; calls and errors per day |
| Tools | Calls and failures per tool and error kind; the slowest tools; calls refused by a rule |
| Your time | Questions asked per tool and per ticket, and how long calls waited for you |
| Checks | Calls that carry facts: test counts and CI conclusions, and every fact name in use |
| Session | Every call and turn of one session in order, with decisions and results |

An agent role is the main agent, or a child such as a reviewer or a scout.

Tables link one level down: click a session in a table, and the Session
dashboard opens with that session chosen. To see one day's sessions, select the
day in the time picker; the Overview's session table then lists that day's.

Datasette shows the queries kept in this plugin as tables. Charts with
`datasette-dashboards` come later.

## Which viewer

Chosen on 2026-10-30 from a comparison of LLM trace platforms, OpenTelemetry
backends, SQL dashboards and tools built for coding agents. Each was judged on
local-only operation, setup, charts, licence, and Linux and macOS support. The
built-in page came later, on 2026-11-03, so that nobody needs to install Grafana
to see a chart.

| Viewer | Verdict | Why |
|---|---|---|
| `/lens web`, the built-in page | **default** | Nothing to install; served by Pi, read-only, stops with the session |
| Grafana OSS with the SQLite data source plugin | optional extra | One local process, SQL panels you can edit, links from a summary to its detail |
| Datasette | optional extra | One Python process over the same index; the queries show as tables |
| MLflow, through OpenTelemetry export | later | Trace waterfalls and LLM views, if they are wanted. An export from the index, not a second record |
| Arize Phoenix | skip | A richer trace view, but its licence is not open source, and its dashboards are fixed |
| Langfuse, Opik, SigNoz, OpenLIT | skip | Three to seven containers each, with ClickHouse or Postgres: too heavy for one developer |

- **The page:** one HTML file in this plugin, drawn by its own small script,
  over fixed queries; see [The web page](web.md).
- **Grafana:** the data source and dashboards load from files kept in this
  plugin, with a variable for the session and the ticket.
- **Datasette:** charts with `datasette-dashboards` come later.
- **Phoenix:** its licence is Elastic-2.0.

**Risk.** The SQLite data source is a small community plugin, last released in
May 2026. It was tried with Grafana 13.3 and plugin 4.0.6 on Linux: the index
opens read-only in WAL mode and every dashboard query runs. macOS is not tried
yet. If the plugin fails, Datasette takes its place over the same index, with
no change to the import.

## What to install

`/lens` and `/lens web` need nothing. Jig does not bundle Grafana or Datasette;
both are optional.

- **For `/lens grafana`:** Grafana OSS and its `frser-sqlite-datasource` plugin,
  installed by you: a package manager on Linux, Homebrew on macOS.
  - `grafana cli plugins install frser-sqlite-datasource` needs the folder
    Grafana loads plugins from: usually `sudo` for a package install, or
    `--pluginsDir <home>/data/plugins` for an unpacked download.
  - Restart Grafana after it.
- **For `/lens datasette`:** Datasette, through `pip`.

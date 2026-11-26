# jig-lens/src

## Overview

The code of `jig-lens`: it imports `jig-core`'s record files into a private SQLite index, answers `/lens` from that index, and serves the same figures as a local page or through Grafana or Datasette. It only reads the records; the index is a copy that `/lens rebuild` makes again.

User-facing behavior lives in the [plugin README](../README.md) and `../docs/`.

## Interface

Entry: `lens(options?: LensOptions): ExtensionFactory` and its `default` export in `index.ts`. `LensOptions` is `Partial<Deps>` plus `viewerDir`.

The factory registers the `lens` config section (`registerSection("lens", validateLens, { setup })`, with a summary for `/jig setup`) and calls `registerLens`. It reads nothing and starts nothing until `agent_end` or a command.

- **Wiring** (`lens.ts`, `deps.ts`, `command.ts`): `registerLens(pi, deps)` hooks `agent_end` (import), `session_shutdown` (stops the page), the `lens` command and the `jig-lens:model-names` event. `Deps` is every outside effect (env, clock, paths, find, spawn, probe, open, sleep) so tests replace them. `parseCommand(args): Command`, `USAGE`, `completions`, `MAX_DAYS` (90), `COMPARE_DAYS` (30), `WORDS`.
- **Terminal command** (`cli.ts`): `run(args, options?)` is `jig lens`: it opens the index, `importRecords`, then prints `recentCalls` (the last `RECENT_CALLS` = 20, oldest first) through `callLines`: time (UTC), `agentName`, tool, action, decision, outcome, `enforcedBy`, a dash for a missing value. It prints `NO_CALLS` when there is none and returns 0 (1 when the records cannot be read, 2 for a word or an option). `bin/jig.mjs` starts it; it takes no words yet.
- **Config and paths** (`config.ts`, `paths.ts`): `LensSettings { port }` (default 3300), `validateLens(raw): string[]`, `settingsFrom`. `stateDir`, `agentDir`, `sessionsDir`, `lensPaths(state, viewerDir)` returning `Paths`, `ownViewerDir()`.
- **Index** (`fields.ts`, `store.ts`, `parse.ts`): `CALL`/`TURN` field lists, `SCHEMA` (tables `call`, `turn`, `imported`, plus SQL indexes), `insertSql`. `openIndex`, `openForReading`, `readIndex`, `readStatus`, `deleteIndex`. `parseLine(text): Row | undefined`.
- **Import** (`import.ts`, `report.ts`): `importRecords`, `importFile`, `cutoffOf`, `RETENTION_DAYS` (90), `ImportOutcome`. `report.ts` has the user-facing lines (`importLine`, `indexLines`, `missingProgram`, `FIRST_START`).
- **Figures** (`queries.ts`, `summary.ts`, `scopes.ts`, `compare.ts`, `compare-format.ts`, `period.ts`, `format.ts`): `Scope` (period, session or ticket), `summarize`, `costOf`, `toolsOf`, `waitOf`, `blockedOf`, `checksOf`, `activeTicket`, `hasRecords`; `blockFor`, `render`, `plain`, `short`; `requestsFor`, `summaryFor`, `compareFor`; `compareOf`, `compareBlock`; `lastDays`.
- **Display** (`display.ts`): `ENTRY = "jig-lens-summary"`, `registerDisplay`, `show`.
- **Page** (`web.ts`, `web-queries.ts`, `session-file.ts`): `LensWeb` (`start`, `stop`, `url`, `link`, `running`), `answer(source, path, query)` for `/api/overview|tickets|ticket|session|call|tools|time`, `readCallDetail`, `MAX_DETAIL_CHARS`. `web-queries.ts` holds every query the page may run (`totalsOf`, `daysOf`, `sessionsOf`, `ticketsOf`, `ticketSessionsOf`, `timelineOf`, `nameModels`, `lanesOf`, `toolTableOf`, `refusedOf`, `loopsOf`, `yourTimeOf`).
- **Viewers** (`viewer.ts`, `start.ts`, `programs.ts`): `Viewer = "grafana" | "datasette"`, `grafanaCommand`, `datasetteCommand`, `probeViewer`, `spawnDetached`, `homepathOf`, `startViewer`, `findProgram`, `browserOpener`. Env names `JIG_LENS_INDEX` and `JIG_LENS_DASHBOARDS`.
- **Usage view** (`usage-dashboard.ts`, `usage-history.ts`, `usage-record.ts`, `usage-names.ts`): `showDashboard` (loaded lazily, needs the terminal UI), `collectHistory`, `summarizeHistory`, `periodRange`, `usageRecord`, `createModelNames`, `MODEL_NAMES_EVENT`.

## Invariants

- **`cli.ts` loads no Pi package.** It imports only files that load none (`import.ts`, `store.ts`, `paths.ts`, `report.ts`, `format.ts`), and `test/cli.test.ts` starts it in a child process with `test/support/no-pi.mjs`, which refuses every Pi package. A name from a record goes through `label` before it is printed, so a record cannot send an escape sequence to the terminal.
- **Imports:** only `jig-core`'s `client.ts` and `kit/` (`theme.ts`, `theme-preference.ts`, `values.ts`). `stateDir` copies the core rule on purpose, because the kit has no state-folder helper; `agentDir` calls `agentDirFor` from `kit/theme-preference.ts` (`paths.ts:23-25`), so the page and the review page read one folder. Do not import other `jig-core` modules.
- **Records are read-only.** Import is idempotent: `INSERT OR IGNORE` by record id, one transaction per file that also moves its `imported` offset. Keep that, or a double import double-counts.
- **No long-lived connection.** A connection lives for one import, status or summary, so a rebuild never deletes a file held open. Reads for the page and summaries open the index read-only.
- **A new column on `call` or `turn`** must be optional (`addMissingColumns` upgrades old indexes without a rebuild), and goes last in `CALL` or `TURN`, so an upgraded index has the columns of a new one in the same order (`agentName` and `enforcedBy` did). Changing the schema changes [index-schema](../docs/index-schema.md) in the same commit.
- **The page is read-only and gated.** Every request needs the right `Host`, the cookie that the one-time `?k=` link sets, and method GET or HEAD. No request carries SQL: only `web-queries.ts` queries run. Keep the checks before any read.
- **The summary never reaches the model:** a session entry (`appendEntry`) in the terminal, a short notification over RPC, nothing without a screen. Do not use `sendMessage`.
- **Viewers bind 127.0.0.1.** Grafana sign-in stays on (`GF_AUTH_ANONYMOUS_ENABLED=false`) and its phone-home settings stay off. Datasette runs with arbitrary SQL off in its metadata. The viewer gets only the env names in `PASSED`, never keys or tokens.
- **`findProgram` skips relative PATH entries**, so a program in the project folder never runs. `browserOpener` starts no shell.
- **Call detail comes from Pi's session file,** bounded (20 000 characters, files up to 64 MB, 5 000 files searched, strict id pattern). It shows only what `jig-core` already masked.
- **Today is the user's local day,** not UTC (`lastDays`).
- **The `/lens` surface is pinned** by `USAGE` and the README's command table. Change both together.

## Side Effects

- **Disk read:** `<state>/records/<YYYY-MM-DD>.jsonl` (`jig-core`'s), Pi's session files under `<agentDir>/sessions`, `<agentDir>/theme.json` (Pi's saved theme, read through `readThemePreference` each time the page renders, with the `ui` config section's `theme` as fallback), plus `../viewer/` and `../web/index.html`.
- **Disk write:** `<state>/lens/index.sqlite` with `-wal` and `-shm` (folder 0700, file 0600; `jig lens` makes it when it is missing, as `/lens` does), `<state>/lens/grafana/` and `<state>/lens/viewer.log`. Rows older than 90 days are removed on import.
- **Network:** `LensWeb` listens on a free port of 127.0.0.1 until `session_shutdown`. Grafana or Datasette listens on `lens.port` (default 3300), started detached and left running. `probeViewer` makes an HTTP GET to 127.0.0.1.
- **Processes:** Grafana or Datasette (detached), the browser opener (`$BROWSER`, `xdg-open`, or `open` on macOS).
- **Env read:** `JIG_STATE_DIR`, `XDG_STATE_HOME`, `PI_CODING_AGENT_DIR`, `BROWSER`, `PATH`, and `HOME` (`os.homedir`). The names in `PASSED` (`viewer.ts:55-69`: `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`, `TZ`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `GRAFANA_HOME`) are copied from Pi's env into the viewer process. `JIG_CONDITION` and `JIG_AGENT_ROLE` shape `compare` through the records.
- **Pi:** hooks `agent_end` and `session_shutdown`, command `lens`, event `jig-lens:model-names`, custom entry `jig-lens-summary`.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-lens/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.
- Tests hold the README's example output and links to the code, so change docs and code together.

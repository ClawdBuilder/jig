# Jig agent guide

Fifteen of the fifteen plugins are built: `jig-core`, `jig-git`, `jig-memory`,
`jig-lens`, `jig-jira`, `jig-logs`, `jig-api`, `jig-ops`, `jig-review`,
`jig-mongo`, `jig-theme`, `jig-sandbox`, `jig-workflow`, `jig-agents` and `jig-session`.
`examples/jig-acme` is an example company plugin for a fictional company: the one
place a company plugin lives in this repository, and its tests run with `npm test`.

Plugin READMEs are the specifications. Code follows them, and when either
changes, the other changes in the same commit. Tests read the tool tables of
`jig-git`, `jig-jira` and `jig-mongo`, and the READMEs and docs of `jig-lens`,
`jig-theme`, `jig-workflow` and `jig-agents`, so change a table and its test together.

- **Read first:** [docs/architecture.md](docs/architecture.md) and
  [docs/permissions.md](docs/permissions.md).
- **Generic only.** Nothing company-specific goes here: no company names,
  internal system names, environment names or hostnames. Those belong in a
  private company plugin. Examples use `staging`, `orders-api`, `PROJ-123`,
  `api.staging.example.com` and GitHub Actions.
- **README shape.** A plugin README follows
  [plugins/jig-workflow/README.md](plugins/jig-workflow/README.md). Detail that would
  take it past about 120 lines goes to `plugins/<name>/docs/`, linked under
  "More detail".
- **Code maps.** `jig-core`, `jig-api`, `jig-ops`, `jig-sandbox`, `jig-agents` and `jig-workflow` each have
  `docs/code-map.md`: every file of `src/` with what it does and who calls it, and one call followed through
  the files. When you add, rename or remove a file in one of them, change its map in the same commit; a test
  fails when they disagree. A source file over 500 lines is reported as a warning: split it by job.
- **`jig-session`** writes one status file per session (its README specifies the format: files only, no port, never an
  argument value). Other programs read it; change the format only as its README says (a new `schema` for a removal).
- **`herdr/` moved.** The Herdr layouts, mods and themes live in `ClawdBuilder/jig-herdr`; Jig publishes the contracts they read (see `docs/contracts.md`).


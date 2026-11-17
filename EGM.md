# Jig Blueprint

## System Overview

Jig is a set of fifteen Pi plugins that let a coding agent work on real systems (git, Jira, logs, MongoDB, CI, deploys, APIs) under a permission floor that no setting can lower. `jig-core` governs every tool call; the other fourteen plugins are tools and features built on its public contract.

This file is for AI agents working in the codebase. It is an index of contracts: open the `EGM.md` of the folder you will change, then the human-facing `README.md` beside it for the specification. The READMEs are the specifications and code follows them.

Rules for contributors live in [AGENTS.md](./AGENTS.md). Read [docs/architecture.md](./docs/architecture.md) and [docs/permissions.md](./docs/permissions.md) first.

## Subdirectories & System Boundaries

- jig-core: [./plugins/jig-core/EGM.md](./plugins/jig-core/EGM.md) - the tool manager: classify, decide, ask, redact, mask, cap and record every call; `jig.json`, secrets, sign-in, watches, the setup questions, the `jig` command for the Jig home and the public kit.
- jig-sandbox: [./plugins/jig-sandbox/EGM.md](./plugins/jig-sandbox/EGM.md) - the agent's shell inside an OS sandbox (bubblewrap or Seatbelt); credentials unreadable, nothing planted that runs later outside.
- jig-agents: [./plugins/jig-agents/EGM.md](./plugins/jig-agents/EGM.md) - the `subagent` tool: child Pi processes started from a role that can only narrow what the child may do.
- jig-api: [./plugins/jig-api/EGM.md](./plugins/jig-api/EGM.md) - run a team's saved API requests (Postman, `.http`, Bruno, OpenAPI, Hurl) by name, with previews for writes.
- jig-git: [./plugins/jig-git/EGM.md](./plugins/jig-git/EGM.md) - `git`, `pr` and `release` tools on GitHub (`gh`) and GitLab (`glab`).
- jig-jira: [./plugins/jig-jira/EGM.md](./plugins/jig-jira/EGM.md) - one `jira` tool over Jira REST v2: bounded reads and previewed, sent-once writes.
- jig-lens: [./plugins/jig-lens/EGM.md](./plugins/jig-lens/EGM.md) - `/lens`: cost, failures, blocked calls and waits from `jig-core`'s records, in Pi, a local page, Grafana or Datasette.
- jig-logs: [./plugins/jig-logs/EGM.md](./plugins/jig-logs/EGM.md) - one read-only `logs` tool over Elasticsearch, OpenSearch or Loki with time windows and named gaps.
- jig-memory: [./plugins/jig-memory/EGM.md](./plugins/jig-memory/EGM.md) - per-ticket notes, evidence, checks and a closing card, plus recall of related earlier tickets.
- jig-mongo: [./plugins/jig-mongo/EGM.md](./plugins/jig-mongo/EGM.md) - one `mongo` tool with per-environment access lists, a `service` that names each environment's database, an index check and count-checked write previews.
- jig-ops: [./plugins/jig-ops/EGM.md](./plugins/jig-ops/EGM.md) - `ci`, `deploy` and `runtime` tools driven by a service catalog; never deploys to production.
- jig-review: [./plugins/jig-review/EGM.md](./plugins/jig-review/EGM.md) - private browser code review; approval only by passkey signature or a `y` in Pi; includes the React page in `web/`.
- jig-session: [./plugins/jig-session/EGM.md](./plugins/jig-session/EGM.md) - one JSON status file per session for other programs, one kind of request file, and idle compaction when `session.compactWhenIdle` is set.
- jig-theme: [./plugins/jig-theme/EGM.md](./plugins/jig-theme/EGM.md) - six palettes as Pi themes, user palettes from `jig.json`, a one-line footer and answer colour.
- jig-workflow: [./plugins/jig-workflow/EGM.md](./plugins/jig-workflow/EGM.md) - named workflows with stages, staged scenarios, holds and evidence the agent cannot mark as passed.
- jig-acme: [./examples/jig-acme/EGM.md](./examples/jig-acme/EGM.md) - the fictional Acme Corp company plugin, the only place a company plugin lives here; its `src/` folders have their own contracts, linked from that file.
- **Plugin events** (Pi's event bus; plugins never import each other): `jig:decision` (emitted by `jig-core` after every decision; read by `jig-git`, `jig-sandbox`, `jig-session`) and `jig:watch-done` (emitted by `jig-core` when a watch ends; read by `jig-agents`); `jig-git:pushed` (emitted by `jig-git`, read by `jig-ops`); `jig-ops:ci-finished` and `jig-ops:artifact-ready` (emitted by `jig-ops`, `jig-workflow` reads `ci-finished`); `jig-review:approved` (emitted by `jig-review`, read by `jig-workflow`); `jig:stage-done` (emitted by `jig-workflow`, read by `jig-memory`); `jig-theme:segment` (any plugin adds a footer part; `jig-sandbox` does); `jig-lens:model-names` (another plugin names a model for `jig-lens`).
- bin: [./bin/EGM.md](./bin/EGM.md) - the `jig` CLI entry, its Node loader hooks, and the optional `pi` tmux launcher (not a plugin; see [docs/launcher.md](./docs/launcher.md)).
- contracts: [./contracts/EGM.md](./contracts/EGM.md) - published front-end contracts; `palettes.json` is generated, `requests.js` is hand-written.
- scripts: [./scripts/EGM.md](./scripts/EGM.md) - repository check and release scripts, including the changelog fragments and the 500-line ratchet, run by `npm run check`, `npm test` and the release flow.
- `docs/` (not linked): human documentation. Start with [docs/architecture.md](./docs/architecture.md), [docs/permissions.md](./docs/permissions.md), [docs/decisions.md](./docs/decisions.md) and [docs/contracts.md](./docs/contracts.md). Markdown and images only.
- `test/` (not linked): repository-level tests (docs check, contracts, launcher, package, release) and `test/support/` loaders. Each plugin has its own `test/` folder.
- `.github/` (not linked): CI workflows and CODEOWNERS; `ci-ok` is the one CI job to require.

## Global Invariants

- **Import boundary.** A plugin may import only `jig-core`'s `src/contract.ts`, `src/client.ts` and `src/kit/*.ts` (`boundaries.test.ts`). Plugins never import each other; they use Pi event-bus events.
- **The public surface is pinned.** Tool and action names, slash commands, `jig.json` sections, record fields and `JIG_*` variables are literals in `plugins/jig-core/test/surface.test.ts` and `plugin-surface.test.ts`. Adding is fine (add the name to the test). Removing or renaming needs a [Decisions](./docs/decisions.md) entry first. Never loosen a pin to get green.
- **Every action is audited.** `plugins/jig-core/test/audit.test.ts` pins each action's effect and approval in its `TABLE`; a new action also needs a README or docs row and a test naming it.
- **The floor is not configurable.** Do not add a setting that lowers it. Production is read-only and masked; unknown tools ask;
  unknown environments count as production; a gate failure blocks the call; a tool that declares `always: "ask"` asks on every call,
  and a file-tool write outside the working folder asks unless the person allowed that folder.
- **No sign-in, no stored credentials in any plugin.** The tool that owns a login does it; a credential reaches a plugin only through `jig-core`, from a source the user configured.
  One exception ([Decisions](./docs/decisions.md#2026-11-17-a-library-that-must-hold-a-credential-gets-it-from-the-resolver)): a
  client library that must hold the secret in-process, such as the MongoDB driver or an SSH tunnel, gets it from
  `jig().secrets.resolve` for that connection only and never returns, logs or records it. `jig-mongo` is the case.
- **Approvals happen inside the waiting tool call.** The only web endpoint that approves is `jig-review`'s page, and only with a WebAuthn passkey signature or after a `y` in Pi. Never add another.
- **Generic only.** No company names, internal systems, environments or hostnames outside `examples/jig-acme`. Examples use `staging`, `orders-api`, `PROJ-123`, `api.staging.example.com`.
- **README and code change together.** Several tests read README tables and docs; change a table and its test in the same commit. The
  thirteen plugins with a `docs/code-map.md` (`jig-core`, `jig-api`, `jig-ops`, `jig-sandbox`, `jig-agents`, `jig-workflow`, `jig-git`,
  `jig-jira`, `jig-logs`, `jig-mongo`, `jig-memory`, `jig-review`, `jig-lens`) must list every `.ts` file of `src/`.
- **A user-visible change and a big file are gated too.** Every change a user would notice adds one file in `changelog.d/`: its
  `### Added`, `### Changed`, `### Fixed` or `### Removed` heading and its line; a release folds the files in. A source file over
  500 lines is a ratchet (`scripts/file-sizes.mjs`, `plugins/jig-core/test/file-sizes.test.ts`): a new file may not cross it and a listed
  file may not grow, so a file that needs more goes into a file of its own.
- **Dependencies are exact pins.** No `^` or `~`; TypeScript is the native 7.x compiler, so no code imports `"typescript"`; Pi packages stay peer dependencies; shipped code imports only root dependencies, Node modules or Pi packages.
- **No secret-shaped literals**, even fake ones, in tests or docs: build them at run time from parts.
- **Where a contract file may not go.** Never put a file directly in `plugins/` or `examples/`: `scripts/check-runtime-deps.mjs` reads every entry there as a plugin folder and crashes on a file. Never put one in `plugins/jig-review/web/src/` or `web/public/`: `src/` is hashed into `web/build.json` and `public/` is copied into `web/dist/`, so a stray file fails `npm run check:dist` and ships to the browser. Never put one in `plugins/jig-core/src/kit/` (`test/surface.test.ts` pins the exact file list) or `plugins/jig-agents/src/` (`test/readme.test.ts` requires every file there to be named in the README layout). That is why `plugins/` and `examples/` have no `EGM.md`, `jig-review/web` has one contract for its whole page, the `jig-core` kit is described in `plugins/jig-core/src/EGM.md` and the `jig-agents` source in `plugins/jig-agents/EGM.md`. Before adding a contract file to any other folder, run `npm test`: a test may pin that folder's file list.
- **Package contents.** `package.json` `files` ships `bin/**`, each plugin's `index.ts`, `src/**`, `package.json` and `README.md`, its
  `skills/**` and `themes/**`, the sandbox broker and the agent roles, `contracts/**`, `docs/**`, `README.md`, `CHANGELOG.md` and
  `LICENSE` (and the built review page, the lens viewer and the lens page). An `EGM.md` under `src/`, `bin/` or `contracts/` ships with its folder; one at
  a plugin root does not.

## Global Side Effects

- **State folder.** `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`: records, spill files, previews, watches, the daily mask key, session status and request files, agent run folders, the `lens` index, and the update-notice and doctor caches.
- **Jig home, or Pi's agent folder.** `jig` runs Pi for the Jig home (`~/.jig`, or `JIG_HOME`), and a plain `pi` for its agent folder
  (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`). The folder holds `jig.json` (written only by setup: `jig setup`, and `/jig setup` in a
  TUI whose agent folder is the home, with a backup of an existing file), user theme files, `jig-review` records and passkeys, and the
  `jig-sandbox` allow-list and background logs.
- **Ticket memory.** `memory.folder`, else `$XDG_DATA_HOME/jig/tickets`, else `~/.local/share/jig/tickets`.
- **Local servers on loopback only.** The review page, the lens page, the diff preview, and detached Grafana or Datasette when asked listen on 127.0.0.1. `jig-sandbox`'s localhost bridge listens on 127.0.0.1 and, best effort, `::1`, on the port of each bridged task or `network.localhost` entry.
- **Child processes.** `git`, `gh`, `glab`, `kubectl`, `helm`, `ssh`, `aws`, `npm`, `ps`, `pass`, `op`, `tmux`, the installed `pi`, browser
  openers, the sandbox broker with `bwrap`, `socat` and `python3`, and child Pi processes for `jig-agents`, as argument lists, never
  through a shell. The one exception: `jig-sandbox` background tasks hand a wrapped command string to the user's shell, inside the sandbox.
- **Network.** Only through `jig-core`'s HTTP path or the plugins' own named clients (MongoDB driver, `gh`, `kubectl`); `jig setup`
  (through `pi install`), `jig update` (through `npm view` and Pi's own update) and a daily update notice reach the network, and
  `jig doctor --network` makes opt-in checks.

## System Verification

- Run: `npm test` (all plugin, example and repository tests, including the 500-line ratchet)
- Run: `npm run check` (links, pins, docs, changelog fragments, the released changelog, contracts, `tsc`, Biome)
- Run: `node scripts/file-sizes.mjs` (the 500-line ratchet alone)
- Run: `npm run check:install` (needs network; a stock Pi installs this working tree and every extension must load)
- Run: `npm run check:web`, `npm run test:web` and `npm run check:dist` (the review page; needs `npm ci` in `plugins/jig-review/web`)
- Run: `npm run test:it` (integration tests; a suite skips when its service address is not set)
- Before a commit: `npm run format`

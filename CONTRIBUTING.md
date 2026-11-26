# Contributing

Jig is a harness: it decides what an agent may do, asks you when it matters, and records what happened. A change is judged
by whether it keeps those promises, not by how much code it adds.

[AGENTS.md](AGENTS.md) is what the coding agents that work in this repository read first: the rules every change
needs, and a pointer for each kind of work. This page is the
short version for a person, in the order you meet the work.

## Before you start

- **Read two pages.** [Architecture](docs/architecture.md) says how one plugin governs every tool call, and
  [Permissions](docs/permissions.md) says what the rules are and which of them configuration cannot change.
- **Generic only.** No company name, host, environment name or project key goes in this repository. Examples use `staging`,
  `orders-api`, `PROJ-123` and `api.staging.example.com`. A company's parts live in a private company plugin, and
  [Writing a company plugin](docs/company-plugin.md) shows how one is built.
- **No secrets and no sign-in.** A plugin never signs in or stores a credential; the tool that owns the login does
  ([Credential sources](plugins/jig-core/docs/sign-in-and-transports.md)).
- **The floor holds.** The fixed rules in [Permissions](docs/permissions.md#the-floor-what-configuration-cannot-change) are not
  settings. A change that would make one of them configurable is refused, however convenient it looks.
- **A plugin README is the specification.** [AGENTS.md](AGENTS.md) says what that requires.

## The repository

Every plugin under `plugins/` is a Pi package, loaded through `package.json`'s `pi.extensions`.

| Path | Holds |
|---|---|
| `plugins/` | the fifteen plugins; [Plugins](docs/plugins.md) names every tool |
| `contracts/` | versioned files for front-ends; [Front-end contracts](docs/contracts.md) |
| `examples/jig-acme/` | the one example company plugin, a template to copy |
| `scripts/` | the gates `npm run check` runs, the install checks, and the release scripts |
| `test/` | the root tests, the isolated host in `test/support/`, the eval corpus in `test/eval/` |
| `bin/` | `jig.mjs`, `jig-gateway.mjs`, the `pi` launcher and the host hooks; [The launcher](docs/launcher.md) |
| `adapters/` | what other agents read: the Claude Code skill; [Gateway](plugins/jig-core/docs/gateway.md) |
| `.claude-plugin/` | the Claude Code plugin's file and its marketplace file: the package root is the plugin |
| `docs/` | the pages and diagrams, including the plugin map and the [writing guide](docs/writing.md) |
| `.github/` | the workflows, the PR and issue templates, CODEOWNERS, the integration services |
| `AGENTS.md`, `CONTRIBUTING.md`, `README.md` | the rules an agent reads first, this page, the front page |

## Set up

| What | Why |
|---|---|
| Node 22.19 or later | Pi runs the TypeScript directly, with no build step |
| Pi 1.5.2, installed globally | The type check reads its types, and its tests start the real Pi |
| The repository's dependencies | `npm ci` at the root |
| `bwrap`, `socat`, `rg` and `python3` | Only for `jig-sandbox`'s tests, which run the real sandbox |

```bash
npm install -g @earendil-works/pi-coding-agent@1.5.2
npm ci
sudo apt install bubblewrap socat ripgrep python3   # Debian, Ubuntu and WSL2
```

### Tests that run real programs

- **`jig-sandbox` tests run the real sandbox.** They need `bwrap`, `socat`, `rg` and `python3` (on Ubuntu 24.04 also
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`), skip with the reason when those are missing, and fail
  in CI (`CI` is set), where they are installed. `JIG_SANDBOX_TEST_BWRAP`, `_SOCAT` and `_RG` name the first three when
  they are elsewhere. A test uses a fake home built at run time, hides the real home's credential paths as well, and never
  reads a file under it or contacts any host but a server of its own.
- **`jig-agents` tests start a real Pi.** `test/real-pi.test.ts` runs the Pi installed next to Node (`JIG_AGENTS_TEST_PI`
  names another) as a child, with this repository's `jig-core` and `jig-agents` and Pi's own scripted model, so it calls
  no model. It skips with the reason when there is no Pi 1.x, and runs in CI. It uses a temporary agent folder and home,
  never `~/.pi/agent`, and never the `pi` on `PATH`, which may be a wrapper that signs in. Two tests also load
  `jig-sandbox` for a read-only `bash`, and skip with the reason when the sandbox's programs are missing.
- **The launcher tests start nothing real.** `test/launcher.test.ts` runs a fake Pi and tmux in a closed world
  (`test/support/launcher-world.ts`), and fails when [The launcher](docs/launcher.md) misses a flag or variable the script
  reads.

The review page in `plugins/jig-review/web` is a package of its own. Change it only when you work on it, and run `npm ci`
and `npm run build` there first; a changed `src/` that was not built fails `check:dist`.

## The checks

| Command | Needs |
|---|---|
| `npm run check` | Pi installed |
| `npm test` | the sandbox's programs, for its tests |
| `npm run test:engine` | nothing: the engine's tests, in a process that cannot load Pi (`npm test` runs them too) |
| `npm run check:install` | network |
| `npm run check:gateway` | network; no Pi and no `npm ci` |
| `npm run check:claude` | Claude Code at the minimum in `jig.agents` or newer; no sign-in |
| `npm run check:web`, `npm run test:web` and `npm run check:dist` | `npm ci` in `plugins/jig-review/web` |

Every one of them passes before a commit; CI runs all of them on every push and pull request, and `ci-ok` is the job to
require. A test suite for a real service skips when its address is not set, so `npm test` never needs one; the integration
suite is `npm run test:it` (see [Integration tests](docs/integration-tests.md)).

- **`check:gateway`** packs the package, installs it with no Pi and asks the gateway real questions. It imports only Node's own
  modules, so it runs before `npm ci`.
- **`check:claude`** has Claude Code itself validate and install the plugin, in a temporary home, with no sign-in and no model.
  `JIG_CLAUDE_BIN` names a Claude Code that is not first on the `PATH`; the tested version is `jig.agents["claude-code"].tested` in
  `package.json`.

`npm test` and `npm run test:it` pass `--test-timeout=600000`. Node applies that to a whole test file, not to each
test, so it bounds a hung file at ten minutes.

One file runs the same way, with the same isolated host as `npm test`:

```bash
node --import ./test/support/host.mjs --test --test-timeout=600000 test/check-docs.test.ts
```

`test/support/host.mjs` isolates the test in a temporary home and resolves Pi's host packages, so a file run on its own
behaves the way it does inside `npm test`. Pass a plugin's file, such as `plugins/jig-git/test/git.test.ts`, the same way.

### Commit emails

A commit's author and committer addresses are part of the public history, so use a public identity. `npm run check:emails`
checks every commit in `origin/main..HEAD`. CI runs it with the private word list from the `SCAN_WORDS` repository
secret, passed as `JIG_SCAN_WORDS_TEXT`; locally, `JIG_SCAN_WORDS_TEXT`, `JIG_SCAN_WORDS` or
`~/.config/jig/scan-words.txt` supplies it. The list stays outside this repository. A matching address fails.

A fork has no private list. There the check passes `noreply@example.com`, an address at `users.noreply.github.com`, and the
maintainer's public address; any other address prints a warning and does not fail, so a fork can still run the suite.

The optional local hook runs the same check before a push. It is not installed for you:

```bash
cp scripts/pre-push-commit-emails.sh .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

## What a change needs

- **A test that fails without it.** Most of this repository is behaviour a reader cannot see, such as a decision, a mask or
  a recorded line, so the test is the only proof.
- **The specification, in the same commit.** The plugin's README, its page under `docs/`, or the code map when a file moves.
- **The agent contract, if the folder has one.** Many folders have an `EGM.md` for coding agents: its interface, invariants and
  side effects. When a change alters one of those, update it in the same commit. No test compares it with the code, so a reviewer
  checks it by hand.
- **The built gateway, if its code changes.** `plugins/jig-core/dist/` is generated and committed. A change to gateway code, to a connector or to a bundled dependency needs `npm run build:gateway`, and
  `npm run check` fails with that command when the built files are stale ([Gateway](plugins/jig-core/docs/gateway.md#the-built-gateway)).
- **A changelog line, if a user would notice.** Add a file in [changelog.d/](changelog.d/): its `### Added`, `### Changed`,
  `### Fixed` or `### Removed` heading and one line, written for the person reading it after an update.
- **A decision, if a public name goes.** Removing or renaming anything in [Compatibility](docs/compatibility.md) needs a dated
  entry in [Decisions](docs/decisions.md) first, and the pin test changes in the same commit. Adding a name is free; add it to
  the test that pins it.
- **A new action is documented and audited.** It needs a row in the plugin's README or `docs/` with its effect, and its line in
  `TABLE` of [the audit](plugins/jig-core/test/audit.test.ts). The audit fails when the two disagree, and the table records the
  environment, effect and approval `classify` gives it, so a write cannot quietly become a read.
- **No loosened pin.** A pin test that fails is either a slip to undo or a change that starts with a decision entry. Never
  delete the literal.

## Where the code goes

A plugin has the same shape as its neighbours, so a reader who knows one knows them all.

| Path | Holds |
|---|---|
| `index.ts` | the factory: it registers a tool and a section, and starts nothing |
| `src/tool.ts` | the tool's actions and their descriptions |
| `src/params.ts` | the validation of the tool's input |
| `src/config.ts` | the validation of the plugin's `jig.json` section |
| `src/plan*.ts`, `src/writes.ts` | a write worked out once, shown, then sent |
| `README.md`, `docs/` | the specification and its detail pages |
| `test/` | the tests, named for the file they test |

Cross-plugin imports are limited to `jig-core`'s `contract.ts`, `client.ts` and `kit/`, and a test enforces it. A plugin that
needs something else from another plugin is a change to the contract, discussed first.

## Commits and pull requests

- **Branch from `main`**, named for the work: `feat/deferred-tools`, `fix/sandbox-mongod-hint`.
- **Say what changed and why** in the subject, in plain words. The body explains a decision the diff cannot.
- **No `Co-Authored-By` lines.**
- **Fill in the pull request template.** It is the same list as the checks above.

## Releasing

A release is one command and one tag; [Releases](docs/releases.md) has the steps, what a version number means, and how a
consumer pins one.

## Reporting a problem

Open an [issue](https://github.com/ClawdBuilder/jig/issues/new/choose) with the exact call, what Jig decided, and what
happened instead. Every `gh issue create` passes `--label bug` when Jig breaks a promise it makes, or `--label
enhancement`; the web forms add these only in the browser. Do not paste a token, a password or customer data.

A vulnerability is different: report it privately as [SECURITY.md](SECURITY.md) says, not in an issue.

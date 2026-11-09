# Contributing

Jig is a harness: it decides what an agent may do, asks you when it matters, and records what happened. A change is judged
by whether it keeps those promises, not by how much code it adds.

[AGENTS.md](AGENTS.md) is the full set of rules, and the coding agents that work in this repository read it. This page is the
short version for a person, in the order you meet the work.

## Before you start

- **Read two pages.** [Architecture](docs/architecture.md) says how one plugin governs every tool call, and
  [Permissions](docs/permissions.md) says what the rules are and which of them configuration cannot change.
- **Generic only.** No company name, host, environment name or project key goes in this repository. Examples use `staging`,
  `orders-api`, `PROJ-123` and `api.staging.example.com`. A company's parts live in a private company plugin, and
  [Writing a company plugin](docs/company-plugin.md) shows how one is built.
- **No secrets and no sign-in.** No plugin stores a credential or runs a login. A credential is a reference that `jig-core`
  reads, and [Secrets](docs/secrets.md) says where it looks.
- **The floor holds.** The fixed rules in [Permissions](docs/permissions.md#the-floor-what-configuration-cannot-change) are not
  settings. A change that would make one of them configurable is refused, however convenient it looks.
- **A plugin README is the specification.** [AGENTS.md](AGENTS.md) says what that requires.

## Set up

| What | Why |
|---|---|
| Node 22.19 or later | Pi runs the TypeScript directly, with no build step |
| Pi 1.5.0, installed globally | The type check reads its types, and its tests start the real Pi |
| The repository's dependencies | `npm ci` at the root |
| `bwrap`, `socat`, `rg` and `python3` | Only for `jig-sandbox`'s tests, which run the real sandbox |

```bash
npm install -g @earendil-works/pi-coding-agent@1.5.0
npm ci
sudo apt install bubblewrap socat ripgrep python3   # Debian, Ubuntu and WSL2
```

The review page in `plugins/jig-review/web` is a package of its own. Change it only when you work on it, and run `npm ci`
and `npm run build` there first; a changed `src/` that was not built fails `check:dist`.

## The checks

| Command | Needs |
|---|---|
| `npm run check` | Pi installed |
| `npm test` | the sandbox's programs, for its tests |
| `npm run check:install` | network |
| `npm run check:web`, `npm run test:web` and `npm run check:dist` | `npm ci` in `plugins/jig-review/web` |

Every one of them passes before a commit; CI runs all of them on every push and pull request, and `ci-ok` is the job to
require. A test suite for a real service skips when its address is not set, so `npm test` never needs one; the integration
suite is `npm run test:it` (see [Integration tests](docs/integration-tests.md)).

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
- **A changelog line, if a user would notice.** Add it under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md): one line,
  written for the person reading it after an update.
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
happened instead. Do not paste a token, a password or customer data.

A vulnerability is different: report it privately as [SECURITY.md](SECURITY.md) says, not in an issue.

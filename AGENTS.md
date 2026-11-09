# Jig agent guide

Every plugin in `plugins/` is built; [the plugin map](docs/plugins.md) names each one and its tools. `examples/jig-acme` is
the one company plugin in this repository, and its tests run with `npm test`.

- **Read first:** [Architecture](docs/architecture.md), [Permissions](docs/permissions.md) and the
  [Glossary](docs/glossary.md).
- **Generic only.** Nothing company-specific goes here: no company names, internal system names, environment names or
  hostnames. Those belong in a private company plugin; [Writing a company plugin](docs/company-plugin.md) shows how.
  Examples use `staging`, `orders-api`, `PROJ-123`, `api.staging.example.com` and GitHub Actions.
- **Specifications.** A plugin README is the specification; when code or README changes, the other changes in the same
  commit. Tests read the tool tables of `jig-git`, `jig-jira` and `jig-mongo`, so change a table and its test together.
- **Docs.** Before you write, change or review any Markdown page, read [Writing the docs](docs/writing.md) and
  [where a page goes](docs/writing.md#where-a-page-goes). `npm run check` fails on a broken link or anchor and on more
  docs warnings than its baseline.
- **The floor in [Permissions](docs/permissions.md) is not configurable.** Do not add settings that lower it.
- **A plugin gets its credential through `jig-core`.** Sign-in stays with the tool that owns it; `jig-core` reads the
  reference and attaches it, so the plugin never sees the value ([Credential sources](plugins/jig-core/docs/sign-in-and-transports.md)).
- **Approvals happen inside the waiting tool call.** Never add a web endpoint that approves, except `jig-review`'s page,
  which approves only with a WebAuthn passkey signature the agent cannot make, or marks "approved in page" and waits for
  a `y` in Pi ([Approvals](docs/approvals.md)). Never add a second one, and never let that endpoint approve on a secret or
  a cookie alone.
- **Checks:** [CONTRIBUTING](CONTRIBUTING.md#the-checks) lists the commands and what each needs; CI runs them on every
  push and pull request, and `ci-ok` is the one required job. Run `npm run format` before committing. `check:install`
  needs network. Package `files` patterns use the `dir/**` form: npm 10/11 and 12 read them differently, CI covers both
  majors, and a local pack proves only this machine's npm.
- **Adding or changing a plugin, tool or action:** read [the plugin contract](plugins/jig-core/docs/plugin-contract.md)
  and [the README shape](docs/writing.md#the-readme-shape); the audit test fails until the README, `TABLE` and a test
  agree (`plugins/jig-core/test/audit.test.ts`).
- **Adding, renaming or removing a source file:** update its plugin's `docs/code-map.md`; a test fails when they
  disagree. A source file over 500 lines is reported as a warning: split it by job.
- **Writing or running tests:** read [Tests that run real programs](CONTRIBUTING.md#tests-that-run-real-programs) (the
  sandbox, a real Pi, the launcher) and [Integration tests](docs/integration-tests.md) (real services).
- **Releasing or editing the changelog:** read [Releases](docs/releases.md). A change a user would notice adds one line
  under `## [Unreleased]` in `CHANGELOG.md`.
- **Changing `jig-session`'s file, the review API, `jig:stage-done` or `contracts/`:** read
  [Front-end contracts](docs/contracts.md); jig-herdr (its own repo) reads them.
- **Anything company-specific:** it does not belong here; copy [`examples/jig-acme`](examples/jig-acme/README.md) into a
  private plugin ([guide](docs/company-plugin.md)).
- **Removing or renaming a public name:** add a [Decisions](docs/decisions.md) entry first. The public surface is pinned by
  `surface.test.ts`, `plugin-surface.test.ts` and `boundaries.test.ts`; adding is fine when the pin is updated in the same
  commit. See [Compatibility](docs/compatibility.md).
- **Changing the Pi or Node version, or a dependency:** read
  [Moving the Pi version](docs/compatibility.md#moving-the-pi-version) and [Releases](docs/releases.md). The tested Pi is `pi-coding-agent@1.5.0`. Dependencies are exact pins, enforced by
  `npm run check`; an `@anthropic-ai/sandbox-runtime` update runs the real-sandbox tests.
- **Changing `bin/` or the launcher:** read [The launcher](docs/launcher.md); it is not a plugin.
- **No secret-shaped literals, even fake ones.** Build a test value from parts, such as `["PMAK", "1a2b"].join("-")`; push
  protection rejects one, and history must then be rewritten (`no-secret-literals.test.ts`).
- **Git:** clear commit messages, no `Co-Authored-By` lines. Push only when asked.

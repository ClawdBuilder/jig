# jig-jira

## Overview

`jig-jira` gives the agent one tool, `jira`, over Jira's REST API version 2, which takes wiki markup and works on Jira Cloud and Jira Data Center. Every write shows a rendered preview before it is sent, and `jig-core` governs every call. The company-specific parts (site, sign-in, project keys, overlay skill) are configuration, not code.

Specification: [README](./README.md); detail: [Parameters](./docs/parameters.md), [Writes](./docs/writes.md), [Configuration](./docs/configuration.md).

## Interface

- **Entry**: `index.ts` re-exports the default of `./src/index.ts`. The entry sits at the plugin root so Pi labels the extension `jig-jira`; the code stays in `src/`.
- **Tool** `jira`: 9 read actions and 8 write actions (the README table lists them). Calls run one at a time, in order.
- **Config section** `jira` in `jig.json`: `site`, `auth`, `projects`, `updateFields`, `fields`, `createDefaults`, `privateNames`, `environment`,
  `timeoutSeconds`, `searchTimeoutSeconds`, `me`, `othersComments`, `commentSearch`.
- **Setup.** `src/onboarding.ts` (`JIRA_SETUP`) declares the section's questions (the site address and the project keys), and
  `src/index.ts` its sign-in methods (`JIRA_METHODS`), so `/jig setup` and `jig setup` ask for them.
- **Code**: [src contract](./src/EGM.md).
- **Not code**:
  - `skills/jira/SKILL.md`: comment style and conventions; a company plugin adds an overlay skill.
  - `docs/`: [Parameters](./docs/parameters.md), [Commented by](./docs/commented.md), [Configuration](./docs/configuration.md), [Writes](./docs/writes.md), [OAuth](./docs/oauth.md), [Wiki markup](./docs/wiki-markup.md), [Not verified](./docs/not-verified.md).
  - `test/`: a fake Jira server and a fake `jig-core` in `test/support/`.

## Invariants

- **Change the README table and its test together.** `test/classify.test.ts` reads the action table of the README and `docs/parameters.md` and checks every action's kind, approval and fields against the code. A new or renamed action also needs a line in `plugins/jig-core/test/audit.test.ts` (`TABLE`, plus a test naming it as `action: "<name>"`) and in the pins of `plugins/jig-core/test/plugin-surface.test.ts` (the tool, action and section names; `surface.test.ts` pins none of them). A removal needs a Decisions entry first.
- **Plugin boundary.** Import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`; tests enforce it.
- **Credentials are attached by `jig-core`.** The plugin holds secret references only and never sees or stores a token or header. A token written into the file is refused and never repeated. There is no sign-in flow and no OAuth flow here: an `oauth` value names a command that `secrets.commands` declares.
- **Writes ask.** They go to `external` (or the configured environment). Preview and execute build the same plan, a change since the preview refuses the write, and a write whose result is unknown is never sent again.
- **Invalid input is not asked about.** A call is checked before anyone is asked; a mistake blocks it with a message that says what to change.
- **Approval stays in Pi.** The rendered page only shows; this plugin adds no endpoint that approves.
- **Generic only.** Examples use `PROJ-123`, `https://example.atlassian.net` and `example.test`.

## Side Effects

- **At load**: registers the `jira` section and the tool declaration with `jig-core`, and the tool with Pi; nothing is read or sent.
- **At run**: HTTPS calls to the configured Jira site through `jig-core`, and nothing else: no disk, no environment variables, no timers. Details in [src contract](./src/EGM.md#side-effects).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-jira/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.

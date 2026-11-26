# jig-git

## Overview

`jig-git` gives the agent three tools: `git` for the local repository, `pr` for pull requests and reviews, and `release` for tags and releases. `pr` and `release` work on GitHub through `gh` and on GitLab (merge requests) through `glab`; the host of `origin` decides which, never the model.

CI is not here: it is the `ci` tool of `jig-ops`, and the two meet in the `jig-git:pushed` event.

Specification: [README](./README.md); detail pages are under `docs/`, starting with [Actions](./docs/actions.md) and [Writes](./docs/writes.md).

## Interface

- **Entry**: `index.ts` re-exports the default of `./src/index.ts`. The entry sits at the plugin root so Pi labels the extension `jig-git`; the code stays in `src/`.
- **Tools and actions**: `git` (18 actions), `pr` (12), `release` (5). The README tables are the specification; see [src contract](./src/EGM.md) for the names.
- **Connector**: `src/connector.ts` has a default export of type `ConnectorModule`, for a host that runs tools with no Pi (a gateway): `name` `jig-git`, `tools` `[pr, release]` (the objects Pi registers), `notOffered` `{ pr: ["watch"], release: ["tag_create"] }` (local writes, which the engine would run with no question) and `register`, which registers the `git` section. `git`, the two gates and the comment watch are not in it.
- **Config section** `git` in `jig.json`: `base`, `protected`, `commitMessage`, `branchName`, `prTitle`, `prTemplate`, `cloneHost`, `watchComments`, `watchBots`, `forges`, `accounts`.
- **Setup.** `src/onboarding.ts` (`GIT_SETUP`) declares what the section needs from a person: the `gh` login, and which `gh` account to use
  for a set of repositories (`git.accounts`), so `/jig setup` and `jig setup` ask for them.
- **Event** `jig-git:pushed`: `{ repo, branch, sha, pr? }`, read by `jig-ops`.
- **Gates**: `git-fetch-host` and `git-guarded-paths`. **Watch kind**: `pr-comments`.
- **Code**: [src contract](./src/EGM.md).
- **Not code**:
  - `skills/git/`: the skill on how to use the tools.
  - `docs/`: [Events](./docs/events.md), [GitLab](./docs/gitlab.md), [Comment watch](./docs/comments-watch.md), [Actions](./docs/actions.md), [Configuration](./docs/configuration.md), [Writes](./docs/writes.md), [Background](./docs/background.md), [Not verified](./docs/not-verified.md).
  - `test/`: temporary repositories, a fake `gh` and `glab` and a fake `jig-core`; `test/it/` holds integration tests.

## Invariants

- **Change the README table and its test together.** `test/classify.test.ts` reads the `## Tool:` tables of the README for each tool and checks every action and its default effect against the code. A new or renamed action also needs a line in `plugins/jig-core/test/audit.test.ts` (`TABLE`, plus a test naming it as `action: "<name>"`) and in the pins of `plugins/jig-core/test/plugin-surface.test.ts` (the tool, action and section names; `surface.test.ts` pins none of them). A removal needs a Decisions entry first.
- **Reads and local writes run; writes to a forge ask.** Each action's environment and effect come from the declaration, and configuration can change a default only within the floor in [Permissions](../../docs/permissions.md).
- **Plugin boundary.** Import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`; tests enforce it. `jig-git` never imports `jig-ops`.
- **Credentials are attached by `jig-core`.** The plugin names a `gh` account and never sees a token. `gh` and `glab` own the sign-in; there is no sign-in flow and no stored credential here.
- **No deploys and no workflows.** CI belongs to `jig-ops`; deploys have their own tool.
- **Approval stays human.** `pr review` never approves, and `jig-git` adds no endpoint that approves.
- **The connector loads with no Pi.** `connector.ts` and every file it imports at run time import no Pi package; a type from `kit/tools.ts` comes in with `import type`, because that file imports Pi. `plugins/jig-core/test/engine/connector-git.test.ts` loads it in a process that refuses every Pi package.
- **`pr` and `release` take the folder from the call.** Every lookup of a repository in their files passes `call.cwd`; `repo.ts` falls back to the folder Pi started in only when none is given. The `git` tool still reads that variable.
- **Generic only.** Examples use `PROJ-123`, `orders-api` and `github.com`.

## Side Effects

- **At load**: registers tools, the `git` section, two gates and the comment watch with `jig-core` and Pi; runs nothing.
- **At run**: `git`, `gh`, `glab` and `ssh -G` processes, forge API calls, writes in the user's repositories, the `jig-git:pushed` event and a polling comment watch. Details in [src contract](./src/EGM.md#side-effects).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-git/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.
- Integration tests (real GitHub, needs a service address): `npm run test:it`.

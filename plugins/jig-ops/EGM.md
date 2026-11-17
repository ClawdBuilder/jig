# jig-ops

## Overview

The plugin for what happens after the code is written: did CI pass, can it go to a test environment, is it healthy. A service catalog (the `ops` section of `jig.json`) describes each service once, and three tools (`ci`, `deploy`, `runtime`) use the same verbs whatever the CI system, deploy method or platform. `jig-core` governs every call.

- **Specification:** [README](./README.md).
- **Code:** [src](./src/EGM.md) and [code map](./docs/code-map.md).

## Interface

- **Entry:** `index.ts` re-exports the default of `src/index.ts` so Pi labels the extension `jig-ops`. The factory is `jigOps(options?)`; the code is in [src/EGM.md](./src/EGM.md).
- **Tool `runtime`:** actions `pods`, `rollout`, `logs`, `events`, `health`. All reads.
- **Tool `deploy`:** `plan` (read), `run` and `rollback` (write in the environment, ask), `status` (read), `watch` (local write). Methods: `helm`, `kubectl-image`, and a read-only `pin`.
- **Tool `ci`:** `services`, `status`, `runs`, `run`, `log` (reads), `rerun` and `trigger` (external writes, ask), `watch` (local write). Systems: GitHub Actions, GitLab CI, Jenkins, Concourse.
- **Config section `ops`:** `services` (each with `repo`, `ci`, `environments`), `watch` and `artifacts`. Registered with `replace` for `services.*.ci.auth`, `services.*.environments.*.job.auth` and `services.*.environments.*.deploy`, `methods` for its sign-in methods, and a `setup` summary for `/jig setup`.
- **Watch kinds:** `ops-rollout` and `ops-ci`.
- **Events:** listens to `jig-git:pushed`; publishes `jig-ops:ci-finished` and `jig-ops:artifact-ready`.
- **Subfolders:** [src](./src/EGM.md) holds all code, and `src/ci`, `src/deploy` and `src/runtime` have their own contracts.
- **Not code, not linked:** `docs/` (catalog, ci, configuration, deploy, runtime, code-map, not-verified), `skills/` (`ops`, `ci`), `test/` (fakes for `gh`, `kubectl`, `helm`, GitLab, Jenkins and Concourse; `test/it/` for real services).

## Invariants

- **Imports:** a plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`. `plugins/jig-core/test/boundaries.test.ts` enforces it.
- **The public surface is pinned.** Every tool and action name and the `ops` section are literals in `plugins/jig-core/test/plugin-surface.test.ts`, and every action's environment, effect and approval is a line in `plugins/jig-core/test/audit.test.ts`. A new action changes the README or docs table and that test together.
- **Code map and README agree with the code.** A file added to `src/` is listed in [docs/code-map.md](./docs/code-map.md) in the same commit; `plugins/jig-core/test/code-maps.test.ts` fails otherwise.
- **Reads run; writes ask.** A rerun, trigger, deploy or rollback asks with an exact preview. Production is never deployed to, and its reads are masked by `jig-core`. This plugin masks nothing itself.
- **Arguments, never a shell.** `gh`, `kubectl` and `helm` get repository, context, namespace, release and chart from the catalog, never from the model. The only named writes are `helm upgrade --install`, `helm rollback`, `kubectl set image`, `kubectl rollout undo`, a CI rerun and a CI trigger.
- **A preview is tied to the run.** If the state differs from what was approved, nothing runs ("changed since the preview"). A command whose outcome is unknown is read once and never sent again.
- **No sign-in and no stored credentials.** `gh`, `kubectl` and `helm` use their own sign-in. A GitLab, Jenkins or Concourse token is a secret reference, a sign-in service or a transport, attached by `jig-core`. When Concourse refuses the login, the message says how the user renews it.
- **A watch has an explicit finish line, and one message wakes the agent.** `required` is the default: it judges the checks the CI entry's `required` names, or every reported check when it names none (`ci/model.ts:151-153`). GitLab and Jenkins without a `required` list watch the whole pipeline or build.
- **Unknown config fields are errors,** and the tools do nothing until the file is fixed.
- **Generic only.** Examples use `orders-api`, `staging` and `api.staging.example.com`; company catalogs live in a company plugin.

## Side Effects

- **Processes:** `gh`, `kubectl` and `helm`, through `jig-core`'s exec.
- **Network:** CI servers over HTTPS through `jig-core`'s request (redirects never followed; a CI entry whose `auth` is a transport may use a plain `http://` address, `ci/config.ts:130-136`), the catalog's https health address, and the Kubernetes API through kubectl.
- **Events and watches:** emits two events on Pi's event bus, listens for pushes, and starts or stops background watches through `jig-core`.
- **Memory only:** the last deploy per service and environment, kept for the session, and module-level state: the last `gh` account used and the `gh --allow-escape-sequences` probe answer (`ci/gh.ts`), the auto-watch's map of started watches (`ci/autowatch.ts`) and the catalog cache (`catalog.ts`). No file is written by this plugin.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-ops/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`
- Whole suite: `npm test`

# jig-workflow

## Overview

`jig-workflow` takes a piece of work, such as a ticket, through a named workflow: ordered stages, each with a goal and exit conditions checked against evidence the plugin can see (a test run at the exact commit, an approved plan, a review, a pull request).

Until a condition holds, listed calls such as `git push` are held through a gate in `jig-core`.

Workflows are JSON files the user or a company plugin supplies; none is built in.

Behavior is specified in the [README](./README.md) and `./docs/`; every source file and a traced call are in the [code map](./docs/code-map.md).

## Interface

- **Entry:** `index.ts` re-exports the default of `./src/index.ts`, so Pi labels the plugin by its folder. Keep it a one-line re-export.
- **Code:** [src](./src/EGM.md) holds the tool, gate, command, state store, conditions and test runner.
- **Tool `workflow`:** `list`, `status`, `start`, `bind`, `submit_plan`, `test`, `scenario`, `advance`, `back`.
- **Command:** `/workflow` (also `list`, `start [name] [ticket]`, `reload`).
- **Config:** the `workflow` section of `jig.json`: `folders`, `disabled`, `tests`, `testTimeoutSeconds`. The section is registered with a `setup` summary for `/jig setup`.
- **Conditions:** `notes-updated`, `plan-approved`, `tests-pass-at-head`, `review-done`, `pull-request-open`, `checks-pass`, `scenarios-pass`, `you-approve`.
- **Events:** consumes `jig-review:approved` and `jig-ops:ci-finished`; publishes `jig:stage-done`.
- **Non-code siblings** (no contract file):
  - `docs/`: detail pages, including `code-map.md`.
  - `examples/`: `feature.json`, `bugfix.json` and `investigation.json`, workflow files to copy; tests read them.
  - `skills/workflow/SKILL.md`: how the agent takes work through its workflow.
  - `test/`: one file per module; `world.ts` runs a whole session through the real `jig-core`.

## Invariants

- **The README and the docs are read by tests.** `test/readme.test.ts` reads the README's tables (conditions, tool, commands, configure), the pages in `docs/` and `docs/plugins.md`. Change a table and its test together.
- **The code map must match `src/`.** `plugins/jig-core/test/code-maps.test.ts` fails when a `.ts` file of `src/` is missing from `docs/code-map.md` or a listed file is gone. A `src/` file is on the 500-line ratchet (`scripts/file-sizes-baseline.json`, `plugins/jig-core/test/file-sizes.test.ts`): a new one cannot cross 500 and a listed one cannot grow. Split it by job.
- **Every tool action is pinned in `plugins/jig-core/test/audit.test.ts`:** a README or docs row, a line in its `TABLE` with environment, effect and approval, and a test that names it. Never loosen a pin to get green.
- **A plugin may import only `jig-core`'s `contract.ts`, `client.ts` and `kit/`.**
- **The agent cannot mark anything passed.** Evidence is recorded by the plugin in a file Pi's file tools and the sandbox cannot write, against the commit or plan it is about.
- **The gate can only make a decision stricter,** and the permission floor is never lowered.
- **No credentials, no sign-in flow.** A test `env` with a credential-looking name is refused; `gh` and `glab` do their own login.

## Side Effects

- **Disk:** per-ticket `workflow.json`, `workflow-history/` and `ticket.json` under the tickets folder; reads workflow files, build files and JDK folders. Details in [src](./src/EGM.md#side-effects).
- **Processes:** `git`, `gh` and `glab` through `jig-core`; test commands in the sandbox, or outside it only with the user's approval.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-workflow/test/*.test.ts"`
- Docs: `node scripts/check-docs.mjs`. The whole suite is `npm test`.
- `test/tests-real.test.ts` runs the real sandbox: it needs `bwrap`, `socat`, `rg` and `python3`, skips with the reason when they are missing and fails in CI.

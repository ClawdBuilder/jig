# jig-workflow/src

## Overview

The code that takes a ticket through a named workflow: it loads workflow files, keeps per-ticket state and evidence in `workflow.json`, decides each exit condition from that evidence, and registers a gate with `jig-core` that holds listed calls until a condition holds. Nothing is built in; workflows are data.

For every file, who calls it and a traced `advance` call, read the [code map](../docs/code-map.md) instead of repeating it here. Behavior is specified in the [README](../README.md) and `../docs/`.

## Interface

Entry: `workflow(options?: WorkflowOptions): ExtensionFactory` and its `default` export in `index.ts`; `WorkflowOptions { host? }` lets tests replace the programs, the sandbox and the clock. `STATUS_MESSAGE = "jig-workflow-status"` is the custom message sent after a compaction. The factory registers:

- **Config section** `workflow` (`validateWorkflow`, `settingsFrom`, `SECTION_FIELDS`: `folders`, `disabled`, `tests`, `testTimeoutSeconds`), with `{ union: ["folders", "disabled"], setup: { summary } }`: a company's and a user's lists add up, and `/jig setup` lists the section.
- **Tool `workflow`** (`tool.ts`): `createTool(rt)`, `checkInput`, `ACTION_NAMES`. Actions: `list`, `status`, `start`, `bind`, `submit_plan`, `test`, `scenario`, `advance`, `back`. The old spelling `submit-plan` is no longer accepted — it is an unknown action — and only `/jig` and the doctor name it with its replacement (`kit/action-names.ts`).
- **Gate** (`gate.ts`): `createGate(rt)`, `GATE_NAME`, `holdMatches`. Holds deny listed calls; four calls always ask.
- **Command** `/workflow` with `list`, `start [name] [ticket]`, `reload` (`commands.ts`).
- **Bus listeners** (`listeners.ts`, `sources.ts`): `jig-review:approved` and `jig-ops:ci-finished` are checked and kept as evidence. The tool's `execute` emits `JIG_EVENTS.stageDone` (`jig:stage-done`) after `start`, `advance` or `back` moves a stage (`tool.ts:246-247`); the `/workflow start` command calls `actions.start` directly and emits nothing.
- **Pi hooks** (`index.ts:48-104`): `input`, `turn_start`, `tool_execution_start`, `tool_result`, `before_agent_start`, `session_start`, `session_compact`, `session_shutdown`. `tool_result` records each call's id, tool and error flag in `Runtime` (up to 1000), which scenario evidence `{toolResult}` reads; `session_start` shows the start line as an info notification when there is a UI.

Main modules (all described in the map):

- **Definitions:** `CONDITIONS` (eight), `REPOSITORY_CONDITIONS`, `parseWorkflow` (`definition.ts`), `loadWorkflows` (`load.ts`).
- **State:** `STATE_FILE = "workflow.json"`, `readState`, `writeState`, `updateState`, `archiveState` (`store.ts`); `ticketPaths`, `readBound`, `addBound` (`ticket.ts`).
- **Evidence:** class `Evidence`, `evaluate`, `evaluateAll` (`conditions.ts`); `inspect` and `RepoView` (`repos.ts`); `readPullRequest` (`sources.ts`); `forgeOf` (`forge.ts`); `parsePlan`, `fingerprintOf` (`plan.ts`).
- **Tests:** `planTests`, `detectCommand`, `runTests` (`tests.ts`), `chooseJava` (`java.ts`), `validateEnv` (`environment.ts`), `outsideCommand` (`outside.ts`).
- **Runtime:** class `Runtime` (`runtime.ts`), `Host` and `coreHost()` (`host.ts`), `StageTools` (`stage-tools.ts`), the `action-*.ts` files re-exported by `actions.ts`.

## Invariants

- **Imports:** only `jig-core`'s `contract.ts`, `client.ts` and `kit/` (`schema.ts`, `tools.ts`, `values.ts`, `action-names.ts`). Other plugins' rules are copied, not imported; `environment.ts` copies `jig-sandbox`'s credential-name patterns and a test compares the two.
- **A file never runs code.** Conditions come from the fixed list in `definition.ts`; a file with an unknown field, condition or stage is rejected whole and reported by `/workflow list`.
- **A stage may narrow the scenarios it accepts.** `scenarios` on a stage lists the scenario numbers its `scenarios-pass` condition judges, so a later stage does not re-check the earlier ones; a number the plan does not have is a failure when the condition is judged, not a pass (`definition.ts:235-250`, `conditions.ts:315-325`).
- **Evidence is decided by the plugin, never claimed.** A test result is stored with the full HEAD and the plan approval with its fingerprint (SHA-256 of the normalized `plan.md`), so a new commit or an edited plan ends it. The agent can neither mark a test passed nor approve a plan.
- **The gate only makes a decision stricter** (allow to ask or deny, ask to deny); the floor still applies. A hold reads the last known pull request, not the network, and acts only in repositories bound to the ticket. Always asked: `submit_plan`, `advance` from a stage listing `you-approve`, `start` with `replace`, and `test` without a sandbox.
- **Asks happen inside the waiting call** with a fingerprint in the preview; `submit_plan`, `advance`, `start replace` and `test` compare it with `host.approvedPreview` and refuse when the evidence changed since the question.
- **`classify` is decided from the input alone.** `list` and `status` are reads; every other action is a local write; `submit_plan` and `start replace` carry `atLeast: "ask"`. Despite that class, `status` (and `/workflow` with no word) calls `gh` or `glab` live and saves the readings into `workflow.json` (`state.observed`, via `rt.saveReadings`; `status.ts:91`), as `advance` does (`action-stages.ts:39`). Every action is pinned in `plugins/jig-core/test/audit.test.ts`; a new action also changes the README table, `docs/plugins.md`, the audit `TABLE` and its test.
- **`workflow.json` is written only here,** by temp file and rename (folder 0700, file 0600) through `writeState`, called by `updateState` and, for a new state, directly by `start` (`action-start.ts:141`). `workflow-history/*.json` is written directly with `writeFileSync` by `archiveState` (`store.ts:353-361`) and, for an unreadable state file, by `start` (`action-start.ts:175-182`). History is capped (200 entries, 20 reviews, 20 CI records). The file is registered as guarded so Pi's file tools and the sandbox cannot write it; so are the configured workflow folders and the project's `.pi/workflows`. Paths are only ever added to that list. `jig-session` reads this file (`version: 1`), so keep its shape.
- **One workflow per ticket.** Replacing keeps the old state in `workflow-history/` and says what is lost.
- **Stage tools:** a stage's `tools` are switched on on entry and off on exit, except what the user switched on (`jig-session.switches`, read only).
- **Handlers never throw into Pi,** and a listener that fails never disturbs the plugin that published.
- **Credentials:** a test `env` entry that looks like a credential is refused. The plugin stores none and has no sign-in flow.

## Side Effects

- **Disk:** `<tickets folder>/<KEY>/workflow.json`, `workflow-history/*.json`, and `ticket.json` (the `repositories` list). The tickets folder follows the `memory` section, else `$XDG_DATA_HOME/jig/tickets`. Workflow files are read from `folders`, `<agent dir>/workflows` and, for a trusted project, `.pi/workflows`.
- **Processes:** `git` for repository state, `gh pr view` and `glab api` for pull requests, all through `jig-core` with argument lists and no shell. `bind` runs the `git` tool's worktree add through the call context.
- **Test commands** are the one shell: they run through `sandbox.run`, or `/bin/sh -c` (through `jig-core`'s `exec.run`) after the user approved the exact commands. An `outside` command goes through `bash` with `outside: true`.
- **Reads:** build files (`gradlew`, `pom.xml`, `package.json`, `go.mod` and others) to choose a test command; installed JDKs, `JAVA_HOME` and `PATH` for Gradle builds. JDK folders come from `$SDKMAN_DIR` (default `~/.sdkman`) `candidates/java`, `/usr/lib/jvm` and, on macOS, `/Library/Java/JavaVirtualMachines` and `~/Library/Java/JavaVirtualMachines` (`java.ts:231-241`).
- **Pi and `jig-core`:** `registerSection`, `declareTool`, `gates.register`, `config.addProtectedPaths`, `addFacts` (text-free counts), `setActiveTools`, `appendEntry`, `sendMessage` after compaction, and the events above.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-workflow/test/*.test.ts"`
- Docs and code map: `node scripts/check-docs.mjs`. `plugins/jig-core/test/code-maps.test.ts` fails when a `.ts` file of `src/` is missing from the code map, so change the map with any added, renamed or removed file.
- The whole suite is `npm test`. `test/readme.test.ts` reads the README and docs tables.

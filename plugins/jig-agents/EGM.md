# jig-agents

## Overview

`jig-agents` lets the agent hand work to child agents: separate Pi processes that load the same plugins as the parent, so `jig-core` governs their tool calls and `jig-sandbox` their `bash`. A child starts from a role (an agent file) that can only narrow what the child may do, and the child enforces that itself.

Specification: [README](./README.md); design: [Design](./docs/design.md); [code map](./docs/code-map.md).

## Interface

- **Entry**: `index.ts` re-exports the default of `./src/index.ts`. The entry sits at the plugin root so Pi labels the extension `jig-agents`; the code stays in `src/`.
- **Tool** `subagent`: actions `start`, `status`, `message`, `stop`.
- **Command** `/agents`: bare, `roles`, `show`, `say`, `stop`.
- **Config section** `agents` in `jig.json`.
- **Code**: [the src section](#code-in-src) (runtime, roles, policy, launch, RPC, approvals, store).
- **Not code**:
  - `agents/`: shipped role files `scout.md`, `reviewer.md`, `worker.md`, read through `shippedFolder()`. A missing shipped folder is a broken install.
  - `skills/subagent/`: the skill on when to delegate.
  - `docs/`: [Design](./docs/design.md), [Roles and agent files](./docs/roles.md), [Configuration](./docs/configuration.md),
    [Options](./docs/options.md), [Not verified](./docs/not-verified.md), [code map](./docs/code-map.md).
  - `test/`: one file per module, `world.ts` (a parent with a fake child) and `real-pi.test.ts`.

## Invariants

- **A role only narrows, and the child enforces it.** Neither the parent nor a prompt is trusted. A child never has fewer extensions than its parent, and `jig-agents` is always loaded in it.
- **Plugin boundary.** Import only `jig-core`'s `contract.ts`, `client.ts` and `kit/` (tests enforce it). Credentials are attached by `jig-core`; this plugin sees none and has no sign-in. A child's approvals come to the user's screen through the parent and never through a file or web endpoint.
- **Pinned surface.** Tool and action names, the `/agents` command and the `agents` section are pinned in `plugins/jig-core/test/plugin-surface.test.ts` (`surface.test.ts` pins none of them); every action is in `plugins/jig-core/test/audit.test.ts`. Add to the pins when adding; a removal needs a Decisions entry.
- **README and docs are read by tests** (`test/readme.test.ts` and others). Change a table and its test together, and keep the README and code in step in one commit.
- **Code map.** Add, rename or remove a file of `src/` and change [the code map](./docs/code-map.md) in the same commit; a test in `jig-core` fails when they disagree. Update [the src section](#code-in-src) too.
- **Public role files name no company model.** Models and limits come from configuration.

## Side Effects

- **At load**: registers with `jig-core` and Pi only; no child starts and no file is written until a session starts and `subagent start` is called.
- **At run**: child Pi processes, run folders under the state folder, git worktrees for writer roles. Details in [src side effects](#src-side-effects).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-agents/test/*.test.ts"`
- `test/real-pi.test.ts` starts a real Pi 1.x and skips with the reason when none is installed (CI installs one).
- Docs: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.

## Code in src

The files in `src/`. They are described here and not in a file of their own because `test/readme.test.ts` requires every file of `src/` to be named in the README's layout, so a contract file cannot live there.

### src: Overview

The code behind the `subagent` tool and the `/agents` command. A parent Pi starts child Pi processes in RPC mode from an agent file (a role), under limits, a narrowed policy and a filtered environment. The child's report returns through a `jig-core` watch; its questions go to the user's screen or are refused.

Specification: [README](./README.md). File-by-file map and one followed call: [code map](./docs/code-map.md), which a test keeps in step with this folder.

### src: Interface

- **Entry**: `index.ts` exports `agents(options?: AgentsOptions)` (`host`, `onRuntime` are test seams) and `default agents()`. It builds a `Runtime`, installs the role gate, and registers the `agents` section (`{ union: ["roles.*.ask.*", "folders", "env"], setup: { summary } }`), the tool declaration, the
  `subagent` watch kind and a status source with `jig-core`.
- **Tool `subagent`** (`tool.ts`: `TOOL_NAME`, `createTool`, `checkInput`, `describeTool`): actions `start`, `status`, `message`, `stop`; `additionalProperties: false`; every action classifies as `local`, `status` as a read and the rest as writes; `executionMode: "parallel"`.
- **Command `/agents`** (`commands.ts`: `registerCommands`): bare, `roles`, `show <id>`, `say <id> <text>`, `stop <id>`.
- **Config section `agents`** (`config.ts`: `validateAgents`, `settingsFrom`, `SECTION_FIELDS`, `DEFAULT_LIMITS`, `RANGES`): `roles`, `limits`, `approvals`, `maxRunning`, `maxStarted`, `approvalWaitMinutes`, `maxAsks`, `folders`, `env`, `branch`.
- **Session**: `runtime.ts` (`Runtime`, `StartInput`), `start-plan.ts`, `child.ts` (`Child`) with `child-process.ts`, `child-questions.ts`, `child-report.ts`, `child-types.ts`, `limits.ts`, `watch.ts` (`WATCH_KIND`).
- **Roles**: `roles.ts` (`parseRole`, `loadRoles`, `shippedFolder`, `roleFolders`), `policy.ts` (`effectiveRole`, `policyOf`), `role-plan.ts`, `role-report.ts`, `role-gate.ts` (`GATE_NAME = "role-policy"`, `roleVerdict`, `installRoleGate`), `skills.ts`.
- **Process**: `launch.ts` (`flagsFor`, `childEnvironment`, `chooseModel`, `checkStarted`, `NEVER_PASSED`), `rpc.ts` (`RpcChannel`), `forward.ts` (`askUser`), `host.ts` (`Host`, `realHost`, `thisPi`), `worktree.ts`.
- **Disk**: `store.ts` (`stateDir`, `agentDir`, `runDirOf`, `writeMeta`, `readMeta`, `removeOld`), `orphans.ts` (`sweep`, `watchParent`); `clean.ts` strips control sequences.
- **Not code**: `../agents/` (shipped role files `scout.md`, `reviewer.md`, `worker.md`), `../skills/subagent/` (when to delegate), `../test/` and `../docs/`.

### src: Invariants

- **Imports from `jig-core`** are only `client.ts`, `contract.ts` and `kit/*`. `store.ts` repeats the state-folder rule rather than import another module.
- **A role only narrows, and the child enforces it.** The parent sets one policy variable (`ROLE_POLICY_VARIABLE`, `JIG_ROLE_POLICY`) in the child's environment; `role-gate.ts` reads it at child start. A policy that is there and unreadable refuses every call and makes `session_start` throw, so the start fails. A gate can only make a decision stricter.
- **No fewer extensions.** `NEVER_PASSED` (`--no-extensions`, `-ne`, `-e`, `--extension`, `--approve`, `-a`) never reaches a child. `checkStarted` stops a child that does not list the commands of `jig-core` and `jig-agents` (and `jig-sandbox` when the parent has it).
- **Fixed flags only.** `flagsFor` names every flag in code; an agent file, a tool call or the project supplies only the value of one. A child always gets `--mode rpc`, `--session-id agent-<id>`, `--exclude-tools subagent,mcp__*` (only `subagent` when the role's `tools` name an `mcp__` tool), `--append-system-prompt <file>` and `--no-approve`. Conditional: `--tools <the role's tools>`, `--model`, `--thinking`, `--no-skills` with one `--skill` per visible skill, `--no-context-files`. No children of children.
- **Filtered environment.** `childEnvironment` forwards a fixed list (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `TZ`, `LANG`, `TMPDIR`, proxy and certificate names, `LC_*`, `XDG_*`, `PI_*`, `JIG_STATE_DIR`, `JIG_CONDITION`) and the names in `agents.env`. Any other name, a key, token or password included, is left behind. A name in `agents.env` or starting with `PI_`, `LC_` or `XDG_` is copied whatever it holds: nothing checks its name or value. The parent's own policy variable is never copied.
- **Every approval failure is a no.** No screen, no answer in `approvalWaitMinutes`, more than `maxAsks`, or an unreadable request: the question is cancelled, and the child counts it as a decline. A stale context is never used as a screen.
- **A child ends once**, in `Child.conclude`, except when the parent session ends: `Child.shutdown` sets state to stopped and writes the outcome itself (no abort, no last-message fetch, no `report.md`), then sends `SIGTERM` at once and `SIGKILL` after 3 s. A child ends with its parent; a left-over one is stopped at the next session start, only when its recorded start time still matches the process.
- **One writer per folder.** A role with `writes` gets its own git worktree and branch (`agent/{name}`) through `jig-core`'s git. `bash` in a read-only role needs `jig-sandbox`; `bash` with `outside: true` is refused.
- **Report text is data.** A child's report and stop text are never instructions; stop output is cut to 20,000 characters and a concluded child's report text to 200,000.
- **Tool input is checked twice**, in `classify` and in `execute`; an `InputError` blocks the call without asking. Limits: role, name and child 40 characters, task 20,000, cwd 500, text 8,000.
- **Defaults** (`DEFAULT_LIMITS`): 40 turns, 30 minutes, 2 dollars; a grace of 2 turns or 2 minutes after a limit. `maxRunning` 4, `maxStarted` 30. Change them with README and docs, which tests read.
- **Size.** `child.ts` and `runtime.ts` are the largest files; a source file over 500 lines is a ratchet
  (`plugins/jig-core/test/file-sizes.test.ts`), so split by job. Add, rename or remove a file here and change the code map in the same commit.

### src: Side Effects

- **Processes**: one Pi child per `start`, run as `node <pi entry>` (`thisPi`, never the `pi` on `PATH`), in its own process group. Stop is close input, then `SIGTERM`, then `SIGKILL`. A `process.on("exit")` hook kills live children. To record and compare start times the host reads `/proc/<pid>/stat` on Linux, or runs `ps -o lstart= -p <pid>` (3 s timeout) elsewhere.
- **Disk**: `<state>/agents/<session>/<id>/` holding `meta.json`, `system-prompt.md` and `report.md`, folder mode `0o700`. `<state>` is `$JIG_STATE_DIR`, else `$XDG_STATE_HOME/jig` or `~/.local/state/jig`. Run folders older than 14 days are removed at session start.
- **Reads**: agent files from `../agents/`, `agents.folders` and `<Pi agent folder>/agents` (the folder is `PI_CODING_AGENT_DIR`); `settings.json` in the Pi agent folder, for the enabled models; skill files (the first 16 KiB of each for its front matter, and the whole file, at most 64 KiB, of a preloaded skill).
- **Env set for a child**: `PI_SUBAGENT_ID`, `PI_SUBAGENT_NAME`, `PI_SUBAGENT_PARENT_PID`, `JIG_PARENT_SESSION`, `JIG_AGENT_ROLE`, `JIG_ROLE_POLICY`, `PI_SKIP_VERSION_CHECK=1`. A child reads `PI_SUBAGENT_ID` and `PI_SUBAGENT_PARENT_PID` to know it is one.
- **Git**: `git worktree add -b <branch> <dest> HEAD` and removal, through `jig-core`.
- **Timers**: a one-second limit tick per child, a parent watchdog in a child (10 s; 5 s grace, then `process.exit`), a 5 s watch poll, 5 s between the steps of a stop, 3 s in the orphan sweep, an approval wait per question. RPC request timeouts: 30 s by default, 60 s for `get_commands` and `get_state`, 30 s for the prompt and `steer`, 5 s for `abort`, `get_last_assistant_text`, `get_session_stats` and the wrap-up `steer`. The RPC reader drops lines over 8 MiB and fails the child after more than 20 unreadable lines.
- **Pi hooks**: `input`, `turn_start`, `tool_execution_start`, `session_start`, `session_shutdown`, and `jig-core`'s watch-done event. A user-screen question and `ctx.ui.notify` for `/agents`.
- **No network** of its own.

### src: Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-agents/test/*.test.ts"`
- `test/real-pi.test.ts` runs a real Pi 1.x as a child and skips with the reason when none is installed.
- Docs and code map: `node scripts/check-docs.mjs` and the code-map test in `jig-core`.
- Types and lint: `npm run check`. Whole suite: `npm test`.

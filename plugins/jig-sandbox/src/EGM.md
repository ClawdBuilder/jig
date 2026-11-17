# jig-sandbox/src

## Overview

The extension behind `jig-sandbox`: it replaces Pi's `bash` with one that runs every command inside Anthropic's sandbox
runtime (in the broker child process), builds the hidden, locked and ask-first rules, scrubs the environment and output,
audits what a command planted, and fails closed when the sandbox is unavailable. It also registers itself with `jig-core`
as the sandbox provider (`jig().sandbox.run`). A `bash` command followed through the files: [code map](../docs/code-map.md).
Plugin overview: [jig-sandbox](../EGM.md).

## Interface

- **Subdirectories:** [background](./background/EGM.md) (tasks, `bg_*` tools, `/ps`), [network](./network/EGM.md) (policy,
  addresses, ask-host, localhost bridge). The broker process is [broker](../broker/EGM.md).
- **Entry (`index.ts`).** `sandbox(options?: SandboxOptions): ExtensionFactory` (default export is `sandbox()`). Registers, through
  `registerJigTool`, the `bash` tool and `bg_output`, `bg_list`, `bg_kill`; the commands `/sandbox` and `/ps`; the `sandbox`
  section (`registerSection("sandbox", validateSandbox, { union: ["env.remove"], setup: { summary } })`); the sandbox provider
  (`api.sandbox.register`); and declarations for `bash` and the background tools. Listens to `jig:decision` (kept in a map capped
  at 500), `message_start`, `tool_call`, `session_start` (`core.start`), `session_shutdown` (`core.stop`). Footer key `jig-sandbox`.
- **`bash.ts`**: `createBashTool(deps)`, `sandboxedOperations(deps, ctx, shell)`, `SANDBOX_DESCRIPTION`. It builds Pi's own bash
  tool with its own operations, so Pi keeps streaming, truncation and time limits.
- **`outside.ts`**: `bashDeclaration({ folder, home })`, `fingerprintOutside`, `outsideProblem`, `OutsideRun`. `outside: true` with a `reason`.
- **`sandbox.ts`**: class `Sandbox` (`start`, `stop`, `whenReady`, `prepare(command, cwd, baseEnv): Promise<Prepared>`, `capture`,
  `rulesFor`, `canWrite`, `setEnabled`, `settings`) and `SandboxRefused`. **`sandbox-types.ts`**: `SandboxState` (`starting` |
  `ready` | `unavailable` | `off` | `stopped`), `SandboxDeps`, `NetworkDeps`, `Prepared`, `Captured`.
- **`broker-client.ts`**: `startBroker(launch)`, `Broker`, `BrokerLaunch`, `BrokerEvent`, `BrokerError`. **`sandbox-setup.ts`**:
  `makeSessionFolders`, `ensureSessionFolders`, `runtimeConfig`. **`runtime-tmp.ts`**: `runtimeTmpDir(tmp, { platform })`, a shorter
  `TMPDIR` for the runtime on macOS, where the session's folder is often too deep for `sun_path`. **`sandbox-messages.ts`**: `refusal`, `messageOf`, `userNamespaceHint`.
- **Rules.** `rules.ts` (`computeRules`, `runtimeFilesystem`, `ruleFor`, `canWritePath`, `ROLE_SOURCE`, `RuleSet`), `lists.ts`
  (`HIDDEN_IN_HOME`, `LOCKED_IN_HOME`, `LOCKED_IN_PROJECT`, `ASK_FIRST`, `FAILURE_SIGNATURES`, ...), `repos.ts`, `files.ts`
  (`FileView`, `nodeFiles`), `pathing.ts`, `platform.ts` (`detectWsl`), `programs.ts` (re-exports `jig-core`'s program lookup).
- **Config (`config.ts`).** `SandboxSettings`, `DEFAULT_SETTINGS`, `validateSandbox`, `settingsFrom`, `readOnlyRole(env)`, `denyNotApplied`.
  Fields: `share`, `hide`, `lock`, `network{mode,allow,deny,localhost}`, `env{keep,remove}`, `docker`, `background{...}`, `programs{...}`.
- **Environment and output.** `env.ts` (`scrubEnvironment`, `looksLikeCredential`, `MIN_SCRUBBED_LENGTH` 8), `output.ts` (`createOutputCleaner`).
- **After a command.** `aftermath.ts` (`createAftermath`), `audit.ts` (`takeSnapshot`, `audit`), `gitconfig.ts` (`parseGitConfig`,
  `isDangerous`, `newDangerous`, `removeEntries`), `explain.ts` (`explainBlocks`, `explainViolations`), `ask.ts` (`createAsker`,
  `serialQueue`), `allowed.ts` (`createAllowed`).
- **Commands.** `commands.ts` (`registerSandboxCommand`: bare `/sandbox` shows the status; `doctor`, `off`, `on`, `allowed`,
  `allowed add|forget`; any other word prints the usage), `doctor.ts` (`runDoctor`).
- **Provider handed to `jig-core`:** `active`, `mode`, `note`, `canWrite`, `allowedFolders`, `whenReady`, `brokerScript` (the absolute path of
  `broker/broker.mjs`, or `SandboxOptions.brokerScript`: the standalone `jig doctor` starts the broker through it rather than knowing
  this plugin's folder) and `run(command, { cwd, maxOutputBytes })` returning `{ code, output, timedOut, truncated }` (last 256 KiB by
  default). The types are `SandboxProvider` and its siblings in `jig-core`'s `contract-sandbox.ts`.

## Invariants

- **Fail closed.** `Sandbox.prepare` waits for the session start and throws `SandboxRefused` when the state is `unavailable` (with
  the fix steps: `/sandbox doctor`, `/sandbox off`), `off` ("the sandbox is off") or `stopped` ("not running", no steps). A command
  never runs bare because something failed. A broker failure restarts the broker and refuses that command once ("run the command
  again"); if the restart fails the state is `unavailable` until the session ends.
- **`sandbox.run` never runs bare** either: it rejects before a session starts or when the sandbox is off.
- **Only `outside: true` with a `reason` runs unwrapped,** and only after `jig-core` let it through (read from `jig:decision`).
  The dialog shows the reason (300 characters) and command (1,000 characters, 8 lines); a longer command is refused ("too long to
  show in full") because it cannot be approved by reading it.
- **The two promises:** the agent cannot read credentials, and cannot plant anything that runs later outside the sandbox.
  Hidden and locked lists start from `jig-core`'s protected paths (`jig().protectedPaths.list()`), so file tools and `bash` agree.
  Everything not listed is writable. Ask-first folders (toolchain managers) are asked about after the command, inside the waiting call.
- **`share` cannot open a hidden credential path** or unlock a locked one; only `/mnt` (the Windows drive) and the real
  `resolv.conf` can be made readable again. The WSL interop folder (`/run/WSL`) is a floor rule: `share` there is ignored with a
  problem line. In a read-only role `share` is ignored.
- **Read-only role.** `readOnlyRole(env)` reads `JIG_ROLE_POLICY` (parsed by `jig-core`'s kit); a policy that exists but cannot be
  read counts as read-only. Then home and working folders are locked (source `ROLE_SOURCE`); `/tmp` stays writable. `readOnly` is laid
  over the settings after reading, so `jig.json` cannot set or clear it. `lock` only adds.
- **`env.remove` is a union** across company and personal files, so a person cannot drop a company's credential name; `*` alone is
  rejected. A variable is also removed, whatever its name, when its value is an address with a password in it
  (`scheme://user:pass@host`). `keep` overrides every one of these rules, but only for a name it lists. Pi's own environment is
  never changed: each command gets a scrubbed copy, with `TMPDIR` set to the session's `tmp` and `PATH` entries inside hidden
  folders removed.
- **Scrubbed values are cut from output** (values of 8 characters or more), terminal control sequences are removed, and the cleaner
  holds back the end of a chunk that may begin a sequence or value. This is a backstop, not a guarantee.
- **The audit moves what it takes away, and deletes only when it cannot move.** After each command a locked path that was absent and now
  exists is moved to `<agentDir>/jig-sandbox/removed` (which the sandbox cannot write); a locked link that changed is put back; a new git
  hook or `.pth` file is taken away; a new git setting that runs a program is removed and the rest of the change stays. Git is not run to
  find it. When the move fails (rename, then copy), `takeAway` deletes the planted path and keeps no copy, because what was planted must
  not stay (`audit.ts:127-150`; `docs/design.md` says so, issue #200). The git-config repair rewrites the file in place with no copy
  (`audit.ts:241`); the notice names the removed keys.
- **`allowed.json` cannot be written by the agent,** so it cannot approve itself. An answer widens the rules from the next command
  on. Questions are serialised through `jig-core`'s `approvals.inTurn`, else the plugin's own `serialQueue`.
- **Nothing starts before `session_start`.** No signal handler is installed in Pi; the broker owns the runtime's.
- **`/sandbox off` and `on` last for the session only;** the footer says `bash: not sandboxed`.
- **Changing a list or message** changes [rules](../docs/rules.md) or [when blocked](../docs/when-blocked.md) in the same commit;
  tests read them. `@anthropic-ai/sandbox-runtime` is pinned exactly, and its update is its own change ([design](../docs/design.md)).

## Side Effects

- **Broker process.** `fork` of `broker/broker.mjs` with Pi's Node, no loader options, `stdio` `["ignore","ignore","pipe","ipc"]`, a short
  environment (`PATH`, `HOME`, `LANG`, and `TMPDIR`/`CLAUDE_CODE_TMPDIR` set to `runtimeTmpDir`, a short folder on macOS) and working
  folder `<session>/broker`. Requests: `hello`, `init`,
  `wrap`, `finish`, `answer-host`, `reset`. Timeouts: start 10 s, default request 30 s, `init` 20 s, `finish` 10 s. `stop()`
  closes the pipe and sends SIGKILL after 3.5 s.
- **Disk.** Session folder `<tmp>/jig-sandbox-<uid>/<mkdtemp>/` (0700) with an owner file (`<pid> <token>`, 0600), `tmp` and `broker`.
  Under `<agentDir>/jig-sandbox/`: `allowed.json`, `removed/`, `background/<session>/`. Crashed sessions' folders are removed only when the
  owner process is gone, never by age.
- **Programs required:** `bwrap`, `socat`, `rg` (found on `PATH`, overridden by `programs`). A missing one makes the state
  `unavailable` with the install command; it never runs unsandboxed. `python3` is not a start-up requirement: `network/bridge.ts`
  looks it up on `PATH`, and without it only `Bridge.problem` is set (shown by `/sandbox` and the doctor) and `network.localhost`
  keeps working.
- **Environment.** Reads `PATH`, `LANG`, `XDG_RUNTIME_DIR`, `WSL_DISTRO_NAME`, `JIG_ROLE_POLICY` (through `readRolePolicy`), the
  toolchain managers' variables for the ask-first rules (`ASK_FIRST_BY_ENV` in `lists.ts`: `NVM_DIR`, `CARGO_HOME`, `GOPATH`, ...) and
  `PI_CODING_AGENT_DIR` (through Pi's `getAgentDir()`). It does not read `HOME`: home is `userInfo().homedir`, and `HOME` is only
  set in the broker's environment. `/sandbox doctor` plants `JIG_DOCTOR_PASSWORD` in its own probe command.
- **Network modes** (`network.mode`): `open` (default), `off`, `filtered`, `ask`. In `filtered` and `ask` the broker is initialised with
  `askHosts: true` and each command gets localhost forwarders; see [network](./network/EGM.md).
- **Pi.** Spawns wrapped commands through Pi's `createLocalBashOperations().exec` and background tasks through `getShellConfig()`;
  sets the footer status, notifications, and the `/sandbox` and `/ps` output.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/*.test.ts"`
- The tests run the real sandbox and need `bwrap`, `socat`, `rg` and `python3`; they skip with a reason when missing and fail in CI.
- Whole suite: `npm test` at the repository root.
- Docs: `node scripts/check-docs.mjs`

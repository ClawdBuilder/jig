# jig-sandbox

## Overview

The agent's shell, in an operating-system sandbox that stays out of the way: bubblewrap on Linux and WSL2, Seatbelt on macOS,
through Anthropic's sandbox runtime. It runs the agent's `bash` commands (and the background tasks and `sandbox.run` commands of
other plugins) inside the sandbox, and keeps two promises: the agent cannot read your credentials, and cannot plant anything that
runs later outside the sandbox. Everything else works as it does outside. When the sandbox cannot start, `bash` is refused with the
steps to fix it; it never runs bare. Specification: [README](./README.md); files and one command followed through them:
[code map](./docs/code-map.md).

## Interface

- **Entry.** `index.ts` re-exports the default factory of `src/index.ts`. Contract of the code: [src](./src/EGM.md).
- **Tools** (pinned in `jig-core`'s `plugin-surface.test.ts`, no actions): `bash` (replaces Pi's; parameters `background`, `name`,
  `notifyOn`, `outside`, `reason`), `bg_output`, `bg_list`, `bg_kill`. `jig-core` classifies `bash` as a local write that its rules
  allow, `bg_output` and `bg_list` as local reads, `bg_kill` as a local write.
- **Commands:** `/sandbox` (`doctor`, `allowed [add|forget <folder|host>]`, `off`, `on`) and `/ps`.
- **Section** `sandbox` in `jig.json`: `share`, `hide`, `lock`, `network.mode` (`open`, `filtered`, `ask`, `off`), `network.allow`,
  `network.deny`, `network.localhost`, `env.keep`, `env.remove`, `programs`, `background.*`, `docker` (reserved). It declares a `setup` summary,
  so `jig setup` lists it. Detail: [README](./README.md#configure).
- **To `jig-core`:** registers the section, the sandbox provider (`jig().sandbox.register`: `run`, `canWrite`, `allowedFolders`, `brokerScript`) and the tool
  declarations. It imports only `jig-core`'s `contract.ts`, `client.ts` and `kit/` (the boundary test enforces it).
- **Subdirectories:** [src](./src/EGM.md) (with [background](./src/background/EGM.md) and [network](./src/network/EGM.md)) and
  [broker](./broker/EGM.md) (`broker.mjs`, the only place the runtime runs).
- **Not contracts:** `docs/` ([rules](./docs/rules.md), [when blocked](./docs/when-blocked.md), [background tasks](./docs/background-tasks.md),
  [design](./docs/design.md)) and `test/`.

## Invariants

- **Two promises, held hard.** Configuration cannot bend them: `share` cannot open a hidden credential path, `lock` only adds, and
  a read-only role (`writes: false`, handed down in `JIG_ROLE_POLICY`) locks home and working folders whatever `jig.json` says.
- **Four kinds of path:** hidden (never readable), locked (readable, never written), ask-first (writable once you say yes) and
  writable (everything else). The hidden and locked lists start from `jig-core`'s protected paths so file tools and `bash` agree.
- **Fail closed, say so.** No sandbox means a refusal with fix steps; every block names its rule, its reason and the way through.
- **The runtime runs only in the broker,** never in Pi's process; a broker fault restarts the broker and refuses the command once.
- **Only a `jig-core` approval runs a command outside** (`outside: true` plus a `reason`); background tasks and `outside` cannot be combined.
- **`network.deny` applies only in `filtered` and `ask`;** `open` is the machine's own network and `off` has none. Cloud metadata
  addresses are always blocked in the modes that filter. macOS: `filtered` and `ask` mean `off` there.
- **Your own `!` commands, Jig's tools and Pi itself are outside the sandbox;** `/sandbox off` turns it off for one session and the
  footer says so.
- **`@anthropic-ai/sandbox-runtime` is pinned to an exact `0.0.x` version.** Its update is its own change, with the real-sandbox tests
  run and the version noted in [design](./docs/design.md). `broker.mjs` stays plain JavaScript.
- **Changing a path list, message or tool parameter** changes [rules](./docs/rules.md), [when blocked](./docs/when-blocked.md) or the
  [code map](./docs/code-map.md) in the same commit; `test/code-maps.test.ts` in `jig-core` fails when `src/` and the map disagree.

## Side Effects

- **Processes.** One broker child per session (`fork` of `broker/broker.mjs`), the wrapped commands Pi spawns, background tasks
  (their own process groups), `socat` forwarders and a `python3` helper for the localhost bridge in `filtered` and `ask`.
- **Disk.** A private session folder under the system temp folder (`jig-sandbox-<uid>/`), and under `<agentDir>/jig-sandbox/`:
  `allowed.json`, `removed/` (what the audit moved away) and `background/<session>/` (task logs). The sandbox itself cannot write these.
- **Network.** None of its own in `open`; in `filtered` and `ask` the runtime's proxy carries each command's traffic and listens on
  `127.0.0.1` and `::1` for bridged task ports.
- **Environment.** Reads `JIG_ROLE_POLICY`, `PATH`, `LANG`, `XDG_RUNTIME_DIR`, `WSL_DISTRO_NAME` and the toolchain managers' own
  variables (`NVM_DIR`, `CARGO_HOME`, `GOPATH`, ...: `ASK_FIRST_BY_ENV` in `src/lists.ts`). It does not read `HOME`: the home folder
  comes from the password database, and `HOME` is only set for the broker. Removes credential-shaped variables from each command's
  copy of Pi's environment. Footer key `jig-sandbox`.
- **Programs needed:** `bwrap`, `socat` and `rg` (`sudo apt install bubblewrap socat ripgrep`; on Ubuntu 24.04 also
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`). Overrides: `programs.bwrap`, `programs.socat`, `programs.ripgrep`.
  `python3` is not checked at start and has no override: only the localhost bridge looks it up on `PATH`.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/*.test.ts"`
- The tests run the real sandbox and need `bwrap`, `socat`, `rg` and `python3`; they skip with a reason when missing and fail in CI,
  where `CI` is set. `JIG_SANDBOX_TEST_BWRAP`, `JIG_SANDBOX_TEST_SOCAT` and `JIG_SANDBOX_TEST_RG` name the first three when they are elsewhere.
- Whole suite: `npm test` at the repository root. Docs: `node scripts/check-docs.mjs`

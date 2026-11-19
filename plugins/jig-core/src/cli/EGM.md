# jig-core/src/cli

## Overview

The code of the `jig` program: Pi for the Jig home (`~/.jig`, or `JIG_HOME`), its own commands (`doctor`, `setup`, `update`,
help and version) and Pi's package commands in the home. `bin/jig.mjs` resolves the home, answers help and version before
importing any of this, hands over to the Jig installed in the home, and routes a Jig command here.

`doctor` and `setup` load the plugins Pi would load into a recording-only host and read Pi's settings, packages and project
trust without importing Pi. `setup` also installs Jig into the home with `pi install`, writes the `jig` command, and asks its
questions in a terminal. `update` moves the packages in the home through Pi's own `pi update`, never the Pi binary. Commands and
fixes: [setup and doctor](../../../../docs/setup-and-doctor.md); file roles: [code map](../../docs/code-map.md). Parent: [src](../EGM.md).

## Interface

- **`run(command, args): Promise<number>`** (`main.ts`). The commands `doctor`, `setup` and `update`, each with its own flags; it
  returns the exit code and never calls `process.exit`.
- **`home.ts`**: `HOME_FOLDER` (`.jig`), `PACKAGE_NAME`, `jigHome(env, home?)` (`JIG_HOME`, trimmed, else `~/.jig`), `homeNpmFolder`,
  `homeFolder`, `homeCommand`, `homeVersion`: the Jig Pi installed in the home, or undefined.
- **`bootstrap.ts`**: `bootstrap(options)` returns `BootstrapResult` (`problems`, and `shim?`, `installed?`, `version?`, `copied?`):
  installs Jig in the home with `pi install` when it is missing (refusing a Pi below the minimum), writes the `jig` command
  (`shimText`, `isShim`, `shimTarget`, `SHIM_MARKER`) and repairs an older one. `BootstrapUi`, `Migrate`, `BootstrapOptions`.
- **`pi-command.ts`**: `PI_PACKAGE`, `PiProgram`, `findPi(env)` (the first `pi` on `PATH` inside Pi's own package, else the global npm
  root; `JIG_PI_HOST`/`PI_HOST_DIR` name the folder), `piArgv`.
- **`help.ts`** (no Pi or plugin imports): `USAGE`, `EXIT_CODES`, `COMMANDS` (the Jig commands, Pi's package commands and `help`),
  `helpFor(topic)`, `nearestCommand(word)`, `strayWordsMessage(command, argv, word)`.
- **`headless.ts`**: `loadHeadless({ agentDir?, workingDir?, env? })` returns `{ state, failures, loaded, jigInPi,
  jigInPiVersion?, jigCopies?, jigListedButMissing?, packageProblems, projectSkipped?, filtered?, timings }`;
  `ownPackage()`, `FEATURES` (each built-in plugin folder to its feature and `jig.json` section), `LoadFailure`, `Headless`.
- **`update.ts`**: `update(args, options)`, `parse`, `piCommands`, `upToDate`, `looksLikeSource`, `installedRequirement`,
  `UpdateOptions`. Targets `--all`, `--self`, `--extensions`, `--models`, a source or `--extension <source>`; flags `--check`,
  `--json`, `--to <version>`, `--yes`/`-y`, `-a`/`--approve`, `-na`/`--no-approve`.
- **`packages.ts`**: `readPackages(agentDir, workingDir, options?)`, `parseGitSource` (`{ host, path, ref? }`), `parseNpmSource`,
  `gitFolder`, `packageFolder` (`{ folder?, problem? }`), `globalNpmRoot`, `configuredGlobalNpmRoot`, `packageIdentity`, `manifestOf`,
  `PackageScope`, `ListedPackage`, `JigEntry`, `ReadPackages`.
- **`package-filter.ts`**: `filterOf`, `applyDelta`, `enabledFiles`, `ResourceType`, `PackageFilter`.
- **`trust.ts`**: `projectTrust(agentDir, cwd)`, `untrustedDetail`, `untrustedSetupLine`, `TrustReading`.
- **`terminal.ts`**: `terminalUi(streams?)` returns a `TerminalScreen` (a `SetupUi` plus `close()` and `quitSaying()`) over the terminal, or over two streams a test gives it. Ctrl+C is an answer, not an error: at a choice or a typed question it returns `undefined` (a cancel), at a yes/no it is a no, and the screen stays open for the next question. With no question waiting (Pi's install, the relay's health check) it is not an answer: the screen is closed (the terminal is cooked again), `quitSaying`'s line is printed, and the signal is handed back to the process group (`streams.interrupt` in a test), so the run and a `pi install` it started end at once; nothing is kept for a later question. `confirm(title, message, { defaultYes: true })` shows `(Y/n)`: Enter is yes, only `n`, `no` or Ctrl+C is no. A choice list numbers its lines right-aligned to the width of the last number, so the names stay in one column from `10)` on.

## Invariants

- **Exit codes.** 0 success, 1 failure, 2 usage error or missing flag; `setup` also 130 on cancel. A word that is not a command
  starts Pi, so a message is never a usage error; a one-word near miss of a command exits 2 with "Did you mean", and a message that
  starts with a command name needs `jig -- "…"`.
- **`doctor` changes no settings.** It accepts only `--json`, `--network`, `--quiet`; any other word is 2. Exit 1 when any line is
  `fail` or the start-up throws. `--json` prints only `{ schema: 1, ...report, failures }` to stdout. A crash in a check is a
  `cli.crashed` fail line, not an exception. A package this Node cannot type-strip is `skip`, not `fail`.
- **`setup` needs a terminal for its questions.** Without one it still installs the home and repairs the `jig` command, then exits 2
  naming `jig setup --yes` (which takes the safe answers and skips the questions) or a terminal; a cancel exits 130. It writes
  everything once at the end, through `writeSetup` (backup, atomic replace), and a result that is not ok restores that backup.
- **Help and version stay fast:** `help.ts` and `bin/jig.mjs` import no Pi and no plugin code before answering them.
- **Project packages are untrusted until Pi would trust them.** Trust fails closed: a malformed `trust.json` is not trusted; the
  closest ancestor with a decision wins; with none, only the agent folder's `defaultProjectTrust` decides, and only `always` trusts.
  Under-loading is the safe direction.
- **The headless host starts nothing:** no tool, session, watch, tunnel or sign-in, and no hook fires. Unknown Pi API names
  are no-op functions so plugins that call newer APIs still load. Session id is `jig-cli`.
- **One version.** Every command reads the home, and Pi's commands run with `PI_CODING_AGENT_DIR=<home>`. A `jig` started from
  another copy hands over before any of this loads (`bin/jig.mjs`); with no Jig in the home, only setup, help and version run.
- **Package semantics mirror Pi 1.5:** project scope wins over user for one identity (an `autoload:false` project entry is
  a delta), and filters read `!`, `+`, `-`, empty lists and `autoload:false` as Pi reads them. Keep `package-filter.ts` in step with Pi.
- **`update` reads the registry first** for every form that moves Jig, refuses before changing anything it cannot finish (two Jig
  entries, a version that needs a newer Pi), and stops at the first `pi` command that fails. `--check` changes nothing; `--json`
  prints only JSON; `CI=true` on a non-TTY implies `--yes`.
- **Terminal prompts:** an empty answer to a choice cancels; confirm is true only for `y` or `yes`.

## Side Effects

- **Reads.** The home's `settings.json`, `jig.json` and `trust.json`, its `auth.json` (provider names only, never a value) and whether
  `models.json` exists; `<cwd>/.pi/settings.json`; each package's `package.json`; the repository's own `package.json`; an old
  `~/.pi/jig-agent/jig.json` when setup offers a copy; and the `jig` command file when setup repairs it. `loadHeadless`
  finds Pi's agent folder with the kit's one `agentDirFor` (`../kit/theme-preference.ts`: `PI_CODING_AGENT_DIR` as Pi reads it, with no
  trimming, else `~/.pi/agent`), for a caller that names no folder; the commands pass the Jig home.
- **Imports and runs extension files** of every installed, trusted package in Pi's settings into the recording host, except
  `jig-core`'s own `plugins/jig-core/index.ts`: `loadHeadless` builds its state with `createState` and sets the process-global
  Jig API slot with `publishJig(buildApi(state))`.
- **Writes.** `setup` makes the home, runs `pi install`, writes or repairs the `jig` command (`~/.local/bin/jig`, or `--bin`), copies
  an old `jig.json` (and `auth.json`/`sessions/` only on a separate yes), and writes `jig.json` through `../setup-write.ts` (backup,
  atomic replace). `doctor` and `update --check` write no settings; `doctor --network` may write the one-day cache
  `doctor-release.json` in the state folder.
- **Processes.** `pi install <source>` (bootstrap), `npm view <name> versions` and `npm view <name>@<version> …` (update), then
  `pi install` or `pi update [--extensions|--models|--extension <source>]` in the home (update). Output is capped softly at
  512 KiB: one chunk may exceed it. `loadHeadless` (so `doctor` and `setup`) runs `npm root -g` (3 s, cached per `PATH` and prefix)
  through `packages.ts` when a user-scope npm package is missing from the agent folder.
- **Network.** None here by itself: the registry is reached through `npm`, Pi's update through `pi`, and `doctor --network` probes
  through `../doctor-network.ts`.
- **Environment.** `JIG_HOME`, `PI_CODING_AGENT_DIR` (set to the home for Pi's commands), `JIG_PI_HOST`/`PI_HOST_DIR`, `NO_COLOR`,
  `FORCE_COLOR`, `TERM`, `COLUMNS`, `CI`, `PATH` (`PATHEXT` on Windows), `npm_config_prefix`/`NPM_CONFIG_PREFIX`, and `HOME` for the
  `~/.local/bin` default.
- **Terminal.** stdout and stderr, and a `node:readline` interface for `setup`.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/cli*.test.ts" "plugins/jig-core/test/update-*.test.ts"`
- Docs: `node scripts/check-docs.mjs`

# bin

## Overview

Two unrelated things live here, and neither is a plugin: Pi never loads them.

- **The `jig` command** (`jig.mjs`, with two Node loader hooks): the CLI named in the root `package.json` `bin`. It is Pi for the Jig home (`~/.jig`, or `JIG_HOME`): it answers help and version before importing Pi or any plugin, hands over to the Jig installed in the home, and routes `doctor`, `setup` and `update` to `plugins/jig-core/src/cli/main.ts`; every other word (Pi's own options, a message, and Pi's package commands) starts Pi through the `pi` launcher with the home as `PI_CODING_AGENT_DIR`.
- **The optional `pi` launcher** (`pi`, `tmux.conf`, `clipboard-copy`): starts an interactive Pi inside its own tmux so closing the window only detaches it. Its specification is the [launcher spec](../docs/launcher.md); this file lists only what the code reads.

## Interface

- **`jig.mjs`** (executable, `#!/usr/bin/env node`):
  - **The home first.** `JIG_HOME` (trimmed) or `~/.jig`, resolved. An outer `PI_CODING_AGENT_DIR` is kept in `JIG_OUTER_PI_DIR` and replaced with the home, so the floor still protects the Pi folder it named.
  - **One version.** When the home holds a Jig (its npm copy, or a local package its `settings.json` lists), a copy started from anywhere else runs that one with the same words and exits its status. With no Jig in the home, only `setup`, `help`, `--help`, `-h`, `--version` and `-v` run; another word says `Jig is not installed in <home>. Run: npx @clawdbuilder/jig setup` and exits 2.
  - `jig --help | -h`, `jig help [command]`: usage or per-command help from `plugins/jig-core/src/cli/help.ts` (`helpFor`,
    `nearestCommand`, `USAGE`). `jig <command> --help` reaches that command's own help: a Jig command's from the same file, Pi's from Pi.
    An unknown name for `jig help` exits 2 with a "Did you mean" hint; so does a one-word near miss of a command, while any other
    word goes to Pi as a message.
  - `jig --version | -v [--json]`: prints `package.json`'s `version`, or `{"schema":1,"version":...}`; any other extra argument exits 2.
  - `jig doctor`, `jig setup`, `jig update`: registers the loader hooks, then `await run(command, rest)` from `plugins/jig-core/src/cli/main.ts`; its result is the exit code.
  - Any other word — Pi's own command, a flag, or a message: starts `bin/pi` with `PI_CODING_AGENT_DIR=<home>` and `JIG_COMMAND=jig`, and exits its status. `jig auth --help` keeps Pi's own help after one Jig line naming the home's `auth.json`.
  - Pi is found by, in order: `JIG_PI_HOST`, then `PI_HOST_DIR` (each must be Pi's package folder, else not found); `<node dir>/../lib/node_modules/@earendil-works/pi-coding-agent`; a `pi` on `PATH` resolved to its package. Not found: the hooks strip types alone and the command still runs; `setup` then says Jig needs Pi and exits 1, and `update` says it needs Pi too.
- **`jig-strip-hooks.mjs`**: `loadTypescript(url, context, nextLoad)` (synchronous, for `module.registerHooks`) strips types with `amaro` (`strip-only`) only for a `.ts` under `node_modules`, which Node will not do itself; other `.ts` files go to Node as `module-typescript`. `load` (for `module.register`) strips every `file:` `.ts` URL with amaro, wherever it lives.
- **`jig-host-hooks.mjs`**: `resolve(specifier, context, next)`. Reads `?host=<dir>` from its own URL and maps `typebox` and `@earendil-works/pi-{coding-agent,tui,ai,agent-core}` to that Pi's own copies.
- **`pi`** (bash 4.4+, executable): the launcher.
  - Flags removed before Pi sees them: `--no-tmux`, `--new`.
  - Variables read: `JIG_NO_TMUX=1`, `JIG_NEW=1`, `PI_BIN`, `HC_TERMINAL_ID`, `JIG_TMUX=1`, `WSL_INTEROP`, `TMUX` (set: already inside tmux, so no new session, and `@jig_cwd` is recorded), `JIG_TMUX_SESSION` (also read, to gate that recording) and `JIG_COMMAND` (names the command in the reattach hints: `jig` sets it, else they say `pi`).
  - Variables set: exports `JIG_PACKAGE_DIR` (the folder above `bin/`, which `bin/tmux.conf` reads); inside tmux the session gets `JIG_TMUX_SESSION`; on WSL it may replace a dead `WSL_INTEROP`.
  - Test-only: `JIG_FORCE_INTERACTIVE=1`, `JIG_TTY`, `JIG_INTEROP_PROBE`, `JIG_INTEROP_FALLBACK`.
  - Exit 127 when no Pi is found or `PI_BIN` is not executable.
- **`tmux.conf`**: settings for `tmux -L jig -f bin/tmux.conf` only. Binds copy-on-select to `$JIG_PACKAGE_DIR/bin/clipboard-copy`.
- **`clipboard-copy`** (bash, executable): copies stdin to the clipboard with `clip.exe` (WSL, fed through `iconv` to UTF-16LE), `wl-copy` (only when `WAYLAND_DISPLAY` is set), `xclip` or `pbcopy`. It reads `WSL_INTEROP` and exports the fallback socket when that is unset. Test-only: `JIG_WSL`, `JIG_CLIP_EXE`, `JIG_INTEROP_FALLBACK`.

## Invariants

- **The launcher is optional and generic.** It sets none of the user's settings, runs no checks at start and never signs in or touches the network. Start checks and password-store unlocking belong to `jig-core` (`startChecks`, `secrets.pass.unlockAtStart`), not here.
- **Skipped when not interactive.** A non-terminal, a print or help flag (`-p`, `--print`, `--mode`, `-h`, `--help`, `-v`, `--version`, `--list-models`, `--export`) or a subcommand (`install`, `remove`, `uninstall`, `update`, `list`, `config`, `auth`, `mcp`) runs Pi directly. In a herdr terminal (`HC_TERMINAL_ID`) tmux is skipped unless `JIG_TMUX=1`.
- **Never a shim loop.** With no `PI_BIN`, the launcher skips any `pi` that does not resolve into `@earendil-works/pi-coding-agent`.
- **Environment values never travel in argv.** Only variable names go on the tmux command line; values pass through tmux's socket (`update-environment`).
  The one value that does is the launcher's own session name, `-e "JIG_TMUX_SESSION=$name"` (`bin/pi:199`; `$name` includes the folder's name, and `tmux ls` shows it anyway). `docs/launcher.md` says so (issue #200). Add no other value to that command line.
- **Docs and script agree.** `test/launcher.test.ts` fails when `docs/launcher.md` misses a flag or variable `pi` reads. Change the script and that page in the same commit.
- **`tmux.conf` reads only `JIG_PACKAGE_DIR`.** Keep `pi` and `clipboard-copy` executable and shipped (`bin/**` is in the package `files`).
- **Help and version stay fast.** They run before Pi or any plugin is imported, and work without Pi installed.
- **Loader hooks stay small.** `jig-strip-hooks.mjs` imports only `amaro` (an exact-pinned root dependency) and Node modules; `jig-host-hooks.mjs` imports only Node modules.

## Side Effects

- **`jig.mjs`:** reads `../package.json`, the home's `settings.json` and each package's `package.json`, writes stdout and stderr, sets `PI_CODING_AGENT_DIR` (and `JIG_OUTER_PI_DIR` for the outer one), registers module hooks for the process, and spawns the home's copy or the launcher.
- **`pi`:** runs `tmux -L jig` (own server, socket and `@jig_cwd` option), `exec`s Pi, and on WSL runs `timeout 2 <cmd.exe> /c exit` to probe the interop socket. Reads `/dev/tty` (or `JIG_TTY`) for the reattach menu, and exits 1 before anything else on a bash older than 4.4.
- **`clipboard-copy`:** runs the clipboard program; on failure `tmux display-message "Not copied: ..."` or a line on stderr, exit 1.

## Verification

- Run: `node --import ./test/support/host.mjs --test test/launcher.test.ts` from the repo root. It runs `bin/pi` with a fake Pi, tmux and timeout in a closed world (`test/support/launcher-world.ts`); nothing real starts.
- Whole suite: `npm test`.

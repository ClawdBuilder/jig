# The launcher

The optional launcher starts Pi in its own tmux session. It is a bash script, not a plugin, so Pi never loads it.
[Jig's README](../README.md) covers install and the first hour; this page keeps the launcher's flags, variables and
behaviour in one place.


The launcher is optional: [`bin/pi`](../bin/pi) starts Pi inside its own tmux, so closing the terminal window only detaches it, and the
next `pi` in that folder offers to reattach. Jig works without it; `pi install` is all Jig needs.

Tested on Linux and WSL2. It needs bash 4.4 or later (macOS ships 3.2: install
a newer one).

**It never signs in and never touches the network,** and it sets none of your settings: Pi's own defaults apply. To set your own,
write a shim at `~/.local/bin/pi` that exports them and runs the launcher. The launcher skips a shim when it looks for the real Pi:

```bash
#!/usr/bin/env bash
export PI_CODING_AGENT_DIR="$HOME/.pi/work-agent"
export BROWSER=/usr/local/bin/my-browser
exec /path/to/jig/bin/pi "$@"
```

| Flag | Variable | Effect |
|---|---|---|
| `--no-tmux` | `JIG_NO_TMUX=1` | Stay out of tmux: Pi runs in this terminal |
| `--new` | `JIG_NEW=1` | Never offer to reattach; start a new session |

The launcher removes these flags before Pi sees the arguments. What it reads besides them:

| Variable | Meaning |
|---|---|
| `PI_BIN` | The Pi executable. Default: the first `pi` on the PATH that is Pi's own npm install, not a shim |
| `HC_TERMINAL_ID` | Set by herdr in its terminals. There the launcher skips tmux, because herdr keeps the terminal alive |
| `JIG_TMUX` | `1` uses tmux in a herdr terminal too |
| `WSL_INTEROP` | On WSL, set to the distro's own socket when it is missing (a shell started over SSH, such as a herdr terminal) or when the one in use does not answer |

The launcher exports one variable, `JIG_HOME`, the folder `bin/` is in, which `bin/tmux.conf` reads. When no Pi is found it exits 127.

A run that is not interactive (no terminal, a print or help flag, or a subcommand such as `install`, `list` or `config`) starts Pi
directly. Otherwise:
- **Interop repair (WSL).** If the Windows interop socket does not answer a 2 second probe, the launcher switches to the distro's own, so
  a browser or the clipboard does not hang. A shell started over SSH has no socket at all; it gets the distro's, with no probe.
- **Copy on select.** Releasing a mouse selection in Jig's tmux copies it with [`bin/clipboard-copy`](../bin/clipboard-copy): Windows'
  `clip.exe` on WSL (found by its full path, since an SSH shell has no Windows folders on its PATH), else `wl-copy`, `xclip` or
  `pbcopy`. When none works, tmux shows "Not copied" and why, instead of looking copied.
- **tmux.** It starts its own server (`tmux -L jig -f bin/tmux.conf`), so your own tmux is never changed. The session is named
  `pi-<folder>-<pid>` and runs the launcher again inside. When tmux returns and the session is still there, it says how to come back.
- **Reattach.** Before it starts a session, `pi` and `pi -c` look for detached sessions started in this folder. One is reattached with
  a one-line notice; several give a numbered menu, and Enter or `n` starts a new one.
- **The environment.** Pi inside tmux sees this terminal's environment, as if started here. Every exported variable is passed on except
  those that describe the terminal or the shell (`TERM`, `TMUX`, `TERM_PROGRAM`, `SHLVL`, `PWD` and a few more; the list is in `bin/pi`).
- **What an earlier terminal left behind.** A variable the tmux server holds from the terminal that started it, and this one does not
  set, is removed from the session. Values travel through tmux's socket, never on a command line.

Two things a launcher is often asked to do are settings of `jig.json` instead, and `jig-core` runs them inside Pi however it
was started:
- **Checks before the first prompt,** such as reaching a VPN-only host: `startChecks` (up to 16 TCP checks), run by `jig-core`.
- **Unlocking a password store at start:** `secrets.pass.unlockAtStart`, run by `jig-core` when `pass` is an enabled backend.

Why the launcher is this small: [Decisions](decisions.md#2026-11-02-an-optional-launcher-with-nothing-a-company-decides).

Back to [the README](../README.md) and [Setup and doctor](setup-and-doctor.md).

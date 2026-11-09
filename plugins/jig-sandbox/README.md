# jig-sandbox: the agent's shell, in a sandbox that stays out of the way

**Status: built.**
Built on [Anthropic's sandbox runtime](https://github.com/anthropics/sandbox-runtime) (Apache-2.0): bubblewrap on
Linux and WSL2, Seatbelt on macOS. The escape and keep-working tests run on Linux and WSL2; the macOS side is
written from the runtime's documentation and not yet tested on a Mac.

`jig-sandbox` runs the `bash` commands the agent sends inside an operating-system
sandbox, and keeps two promises:
- **the agent cannot read your credentials:** SSH keys, cloud and cluster logins,
  tokens, the secret files of your projects — and a command does not start with an
  environment variable that names one, or with an address that carries a password;
- **the agent cannot plant anything that runs later outside the sandbox:** in your
  shell start-up files, your `PATH`, git hooks, Pi's settings, build init scripts.

Everything else works as it does outside: builds and their caches, git, package
installs, the network, servers on `localhost`. When a command does hit a rule, it
says which rule and why, and offers a way through.

Removed values are also replaced in a command's own output when they appear exactly. That
is a backstop, not a guarantee: output that encodes a value another way is not recognised.
[The environment a command starts with](docs/rules.md#the-environment-a-command-starts-with)
says exactly which variables go.

![Pi, Jig's tools, your own commands and the broker run on the host; the agent's bash runs in the sandbox, where paths are hidden, locked, ask-first or writable](../../docs/img/sandbox-boundary.svg)

*Where the line runs. Your own `!` commands and Jig's tools stay outside; only what the agent runs in `bash` is inside, and the hidden paths start from the list `jig-core` protects from Pi's file tools.*

## Commands

| Command | What it does |
|---|---|
| `/sandbox` | Whether bash is sandboxed, every rule and where it came from, and this session's outside runs |
| `/sandbox doctor` | Checks the requirements and runs the proof commands |
| `/sandbox allowed` | Folders and hosts you allowed; `add <folder\|host>` and `forget <folder\|host>` |
| `/sandbox off`, `/sandbox on` | Turns it off or on for this session only |
| `/ps` | The [background tasks](docs/background.md): their output as it grows, and stopping one |

## Rules

The full list is in [The rules](docs/rules.md): hidden, locked, ask-first and writable paths, and why.

## Configure

In `~/.pi/agent/jig.json`, under `sandbox`. Every field is optional.

| Field | Default | Meaning |
|---|---|---|
| `share` | none | Folders writable although a rule hides them, such as a Windows work folder under `/mnt` |
| `hide`, `lock` | none | More hidden or locked paths |
| `network.mode` | `open` | `open`, `filtered`, `ask` or `off` |
| `network.allow` | none | Hosts `ask` lets through without asking: `api.example.com`, `*.example.com:443`. Used in `ask` only |
| `network.deny` | none | Hosts always refused in `filtered` and `ask`, in the same form. Not applied in `open`, and `/sandbox` warns |
| `network.localhost` | none | Ports on this machine that commands may reach in `filtered` and `ask` |
| `env.keep` | none | Variables passed in although their names look like credentials |
| `env.remove` | none | More variables to keep out: names, or simple patterns such as `ACME_*` or `*_SECRETX`. Adds to what is already removed, never removes less |
| `programs` | found on `PATH` | Absolute paths of `bwrap`, `socat` and `ripgrep` when they are elsewhere |
| `background.maxTasks`, `.maxRuntimeMinutes`, `.keepFinished`, `.wake` | 4, 240, 12, `on` | Tasks at once, longest run, finished tasks kept, `off` to not wake the agent ([limits](docs/background.md#limits)) |
| `docker` | `false` | Reserved: not supported on Linux (see Network) |

## Install

Linux and WSL2: `sudo apt install bubblewrap socat ripgrep`, and `python3` (usually there
already) to carry a background task's server in `filtered` and `ask`. On Ubuntu 24.04, if the doctor
says bubblewrap cannot make a user namespace:
`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. macOS: nothing to
install, the sandbox is part of the system. Native Windows is not supported yet.

## Company part (in the company plugin)

Hosts to deny (production databases) and to allow in `ask` mode, more hidden or
locked paths, and the environment names it keeps out: through `jig-core`'s section
defaults and protected paths. The company's `env.remove` and yours add up, so a
teammate's own list extends it rather than replacing it. A deny list does nothing in the
default `open` mode, so a company that wants it applied also defaults `network.mode` to
`filtered` or `ask`; otherwise `/sandbox` warns each user.

## Later

- **Stand-in credentials:** a command gets a placeholder, and the proxy puts the real
  value back only on the way to an allowed host, so a build can reach a private
  repository without ever seeing its token.
- Native Windows.

## Layout

```text
index.ts            the entry Pi loads: it hands on src/index.ts, so Pi shows the plugin's name
broker/broker.mjs   the only place the runtime runs: a plain-JavaScript child process
src/                index.ts (entry), bash.ts (the tool, and one command outside), sandbox.ts + sandbox-types.ts +
                    sandbox-setup.ts + sandbox-messages.ts (the session), rules.ts + lists.ts + repos.ts (the rules as
                    data), audit.ts + gitconfig.ts (after a command), ask.ts + allowed.ts (questions), explain.ts,
                    env.ts, output.ts, commands.ts, doctor.ts
src/background/     the tasks: tasks.ts (start, stop, limits) with tasks-deps.ts, task-record.ts, capture.ts and
                    after-end.ts, notify.ts (waking), patterns.ts, logfile.ts + output.ts (the log and its reading),
                    process.ts + sessions.ts (stopping, crash clean-up), tools.ts, ps.ts
src/network/        the callback's rules (addresses.ts, hosts.ts, policy.ts), the question to you (ask-host.ts),
                    the localhost bridge (bridge.ts) and how they are wired to the sandbox (wiring.ts)
test/               rules as data, and the escape and keep-working tests in the real sandbox
```

## More detail

- [Code map](docs/code-map.md): every file, who calls it, and a `bash` command followed through them
- [The rules](docs/rules.md): every hidden, locked and ask-first path, and why
- [When a command hits a rule](docs/when-blocked.md): the messages, the prompts, the ways through
- [Network](docs/network.md): the modes, the proxy and the host rules
- [Background tasks](docs/background.md): the tools, limits, waking, `/ps`
- [Design](docs/design.md): how it is built, what the earlier sandbox taught us, the tests


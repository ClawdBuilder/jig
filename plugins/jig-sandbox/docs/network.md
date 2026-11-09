# Network

The sandbox network modes and their rules. Back to the [jig-sandbox README](../README.md).

| Mode | What it does |
|---|---|
| `open` (default) | The machine's own network, as outside: every host, plain DNS, `localhost` |
| `off` | No network at all, `localhost` included |
| `filtered` | Through the sandbox's proxy: every public host, except metadata and local addresses, and `deny` |
| `ask` | `filtered`, and a new host waits while Pi asks you: once, this session, always or no |

In `filtered` and `ask` each command has a network of its own, and a refused connection
says why: `cannot reach 169.254.169.254:80: it is a cloud metadata address, and those are
always blocked.`
- **Names resolve in the proxy,** so HTTP clients work and `dig` and `getent` do not.
- **A port on this machine** (a local database) is reachable when you list it in
  `network.localhost`. A `jig-core` tunnel on `localhost` is not, unless listed.
- **A [background task's server](background.md#reaching-a-tasks-server)** is carried into
  later commands, and to you, at the same port.
- **macOS:** `filtered` and `ask` are tested on Linux and WSL2, and mean `off` on a Mac;
  `/sandbox` says so.

**`network.allow` and `network.deny` apply in `filtered` and `ask` only.** They are read by the
proxy those two modes route commands through. `allow` matters in `ask` alone (`filtered`
already lets every public host through), and **`deny` does nothing in `open`**, the default,
or in `off`: a host you list there is not refused. `/sandbox` and `/sandbox doctor` warn when
`deny` is set in `open`; set `network.mode` to `filtered` or `ask` to apply it.

In every mode, `ssh` has no keys (they are hidden), so git over SSH goes through Jig's
`git` tool, and Unix sockets are closed, the Docker socket included: through Docker a
command could run anything as root. For Docker, the agent asks to
[run that command outside](when-blocked.md#running-one-command-outside).

**When to choose which.** In `open` a command can reach anything on this machine's
`localhost`, including a tunnel `jig-core` opened for a database. If your tunnels lead to
production, `filtered` or `ask` keeps bash away from them. `ask` is for when you want to see
every new host; `network.allow` lists the ones that never need asking.

# Configuration: the `sandbox` section

The fields of the `sandbox` section of `jig.json`. Back to the [jig-sandbox overview](../README.md).

## The fields

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
| `background.maxTasks`, `.maxRuntimeMinutes`, `.keepFinished`, `.wake` | 4, 240, 12, `on` | Tasks at once, longest run, finished tasks kept, `off` to not wake the agent ([limits](background-tasks.md#limits)) |
| `docker` | `false` | Reserved: not supported on Linux (see Network) |

Back to the [jig-sandbox overview](../README.md).

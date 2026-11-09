# Configuring agents

The `subagent` section and the defaults it lays over a role. Back to the [jig-agents README](../README.md).

In `~/.pi/agent/jig.json`, under `agents`. Every field is optional.

## Configure

| Field | Default | Meaning |
|---|---|---|
| `roles.<role>.model` | the parent's | `provider/id`, with `:thinking` if wanted; checked against `enabledModels` |
| `roles.<role>.maxTurns`, `.maxMinutes`, `.maxCost` | `limits` | Limits for one role |
| `roles.<role>.actions`, `.ask` | the file's | `{ "git": ["status", "log"] }`: narrows the file's actions, adds to its ask |
| `roles.<role>.skills`, `.preload`, `.context`, `.thinking` | the file's | Replace the file's values |
| `limits.maxTurns`, `.maxMinutes`, `.maxCost` | 40, 30, 2 | Limits for every role |
| `approvals`, `roles.<role>.approvals` | `forward` | `forward` or `deny` |
| `maxRunning`, `maxStarted`, `approvalWaitMinutes`, `maxAsks` | 4, 30, 30, 10 | Counts and waits |
| `folders`, `env` | none | More folders of agent files; extra variable names for children |
| `branch` | `agent/{name}` | The branch of a worker's worktree; `{name}` is the child's name |

An unknown field is an error, as in `jig-core`, and so is `writes` or `tools` under a role: they are the file's.

- **Thinking, strongest first:** `roles.<role>.thinking`, the `:level` on the model (`provider/id:low`), then the file's.
- **A company plugin** sets `roles.scout.model` and the like through `jig-core`'s section defaults. Its `ask`, its role
  `folders` and its `env` names add to yours, so your own lists extend the company's rather than replacing them.

[Design](design.md#configuration) has the ranges.

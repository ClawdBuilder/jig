# jig-agents: child agents that Jig's rules still govern

**Status: built.** Tested with a fake child that speaks Pi's RPC protocol, and with the stock Pi 1.5 as a real child
(this repository's `jig-core` and `jig-agents`, on Pi's own scripted model). No model is called; what only
a real one can show is in [Not verified](docs/not-verified.md).

`jig-agents` lets the agent hand work to **child agents**. A child is a separate Pi process that loads the
same plugins as its parent, so `jig-core` governs its tool calls and `jig-sandbox` its `bash`.

A child is started from a **role**, and a role can only make a child *less* than its parent: fewer tools, fewer
actions of a tool, no writing, fewer skills to read. The child enforces that itself, so neither the parent nor
a prompt has to be trusted.

When a child's rules say "ask", the question comes to your screen, labelled with the child's name, and your
answer goes back. Each child has limits on turns, minutes and cost, and its report reaches the parent
without polling.

For example, the agent starts a `scout` with the task "find where `orders-api` rounds order totals" and carries
on. The scout can read the code and run `rg`, `git log` and `git blame`; it cannot edit a file or push. When it
finishes, its report arrives as a message.

![The agent starts a child through jig-agents, which runs a separate Pi in RPC mode with the same plugins, sends it the task, counts its limits, brings its questions to your screen and your answers back, and delivers its report as a message](../../docs/img/agents-rpc.svg)

*How a child runs. The child is a full Pi with the same plugins, so Jig's rules govern it; its questions come to you through the parent, and its report comes back without polling.*

## The decision

Jig builds this plugin itself, on Pi's own RPC mode, and adopts no package: none of the Pi store's subagent
packages keeps every child under `jig-core` and `jig-sandbox`, brings its questions to your screen, and limits
turns, time and cost. See [Options](docs/options.md) and
[the decision](../../docs/decisions.md#2026-10-31-jig-agents-is-built-by-us-on-pis-rpc-mode).

## Tool: `subagent`

| Action | Kind | What it does |
|---|---|---|
| `start` | local write | Starts a child from a role and a task, and returns at once |
| `status` | read | This session's children: state, turn, minutes, cost, questions waiting |
| `message` | local write | Steers a running child, or resumes a finished one in a new process |
| `stop` | local write | Stops a child and returns its partial report |

`start` takes a `role`, a `task`, and optionally a `name` and a `cwd` inside the parent's folder. It takes no
model and no tool list: those come from the role and configuration.

| Command | What it does |
|---|---|
| `/agents` | The children of this session and any problem; `/agents roles` lists the roles |
| `/agents show <id>` | The last lines of a child's transcript |
| `/agents say <id> <text>`, `/agents stop <id>` | `message` and `stop`, typed by you |

## Limits

A child asks through its parent's screen; [Approvals in a child](docs/design.md#approvals-in-a-child) has the path and
the failures.

| Limit | Default | How it is counted |
|---|---|---|
| `maxTurns` | 40 | The parent counts the child's finished turns |
| `maxMinutes` | 30 | Wall clock, not counting time spent waiting for you |
| `maxCost` | 2 | US dollars Pi reports for the child, checked after each turn |

At a limit the child is told to write its report from what it has, gets two more turns or minutes, and is
then aborted. The report says which limit stopped it. Cost is bounded only for a model that Pi prices, and
there is no "no limit" setting.

## Rules

- **A role only narrows, and the child enforces it.** The parent passes the policy in the child's environment; the
  child reads it at start. A policy it cannot read makes the child refuse to work, and the start fail.
- **Never fewer extensions.** The plugin never passes `--no-extensions` or `-e`, and stops a child that does
  not list the commands of `jig-core` and `jig-agents` (and of `jig-sandbox`, when the parent has it) before it
  gets its task. `jig-core` is what governs the child, and `jig-agents` is what enforces its role there: a child
  without it would run unnarrowed.
- **One writer per folder,** in a worktree other than the parent's.
- **No orphans.** A child ends with its parent session, for any reason; one left by a parent that died is
  stopped at the next session start.
- **Few children.** `maxRunning` (4) at once, `maxStarted` (30) per session, none started by a child.

## Configure

The `subagent` section, its defaults and the fields are in [Configuring agents](docs/configuration.md).

## Company part (in the company plugin)

- which model each role uses, limits that fit its prices, a folder of its own roles (`agents.folders`) and the
  variable names its model provider needs in a child (`agents.env`), through `jig-core`'s section defaults;
- skills of its own, each with `metadata: jig-tool:` naming the tool it extends, so a role sees it with that tool;
- a hold in its workflow files on `subagent start`, such as until the plan is approved.

## Layout

```text
jig-agents/
  index.ts  the entry Pi loads: it hands on src/index.ts, so Pi shows the plugin's name
  src/      index (factory), runtime + start-plan (the session's children; what a start works out), child (one child)
            with child-process, child-questions, child-report and child-types, rpc, forward (questions), limits,
            launch (flags, environment, model), roles + policy (an agent file; configuration laid over it), role-plan +
            role-report (what a role comes to; /agents roles), role-gate (the child enforces it), skills, config,
            commands, tool, watch, worktree, store + orphans, host, clean
  agents/   scout.md, reviewer.md, worker.md; skills/subagent/SKILL.md: when to delegate
  test/     one file per module; world.ts runs a parent session with a fake child, real-pi.test.ts a real Pi
  docs/     the detail pages below
```

## More detail

- [Code map](docs/code-map.md): every file, who calls it, and a child followed from `start` to its report
- [Roles and agent files](docs/roles.md): the file format, the roles that ship, skills and read-only bash
- [Configuring agents](docs/configuration.md): the `subagent` section and its defaults
- [Options](docs/options.md): the Pi store's packages compared, how others specialise a subagent, and what the earlier harness taught
- [Design](docs/design.md): launch, the role's policy, approvals, limits, results, configuration, tests
- [Not verified](docs/not-verified.md): what only a real model run can show

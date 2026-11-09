# jig-workflow: named workflows, with stages, holds and evidence

**Status: built.** Named workflows with stages, holds and evidence, tested with the real `jig-core` and sandbox.

`jig-workflow` takes a piece of work, such as a ticket, through a **workflow**: a named, ordered list of
stages, each with a goal for the agent and the conditions that let the work move on. The conditions are
checked against evidence the plugin can see (a test run at the exact commit, a plan you approved, a
review, a pull request), and until one holds, calls such as `git push` are held.

You write the workflows; the plugin has none built in, only examples to copy, such as `feature`
(understand → plan → build → review → deliver → accept → done), `bugfix` and `investigation`. Start one
with `/workflow start feature PROJ-123`: the agent then reads each stage's goal, asks for tests and
approvals through the `workflow` tool, and moves on when `advance` finds every exit condition met.

![Workflow files name the stages; evidence is made where it can be checked and saved against a commit in workflow.json; eight conditions are read from it; a gate in jig-core holds calls](../../docs/img/workflow-flow.svg)

*From file to hold. A stage's exit conditions say which evidence counts, each result is saved against the commit or plan it is about, and the same conditions that stop `advance` make the gate hold a call.*

## A workflow file

One JSON file per workflow, named after it, such as `~/.pi/agent/workflows/feature.json`:

```json
{
  "name": "feature",
  "description": "A change to a service, from plan to acceptance on staging",
  "match": { "ticket": "^PROJ-\\d+$" },
  "stages": [
    { "id": "plan", "goal": "Write plan.md with numbered acceptance scenarios", "exit": ["plan-approved"] },
    { "id": "build", "goal": "Change the code and test it", "exit": ["tests-pass-at-head"] },
    { "id": "done" }
  ],
  "holds": [
    { "until": "plan-approved", "calls": ["git commit", "git push", "write", "edit"] },
    { "until": "tests-pass-at-head", "calls": ["git push"] }
  ]
}
```

A hold denies the listed calls, with the reason and the condition, until it holds. `write`/`edit` by path and `git`/`pr` by
repository are held only in bound repositories; `bash` is not held unless listed — the sandbox's protected paths guard its
writes. Three examples are in [`examples/`](examples/); every field, a stage's `tools` included, is in [Files](docs/files.md).

## Conditions

A fixed list, checked by the plugin itself, so a file never runs code. Each is decided from evidence, as
[Conditions](docs/conditions.md) says.

| Condition | Holds when |
|---|---|
| `notes-updated` | The ticket's notes changed since the stage began (see `jig-memory`) |
| `plan-approved` | You approved this exact `plan.md`; an edited plan needs approving again |
| `tests-pass-at-head` | Each bound repository's tests passed at its current HEAD, in the sandbox or outside it with your yes |
| `review-done` | A `jig-review` approval covers each bound repository's current HEAD |
| `pull-request-open` | Each bound repository's branch has an open pull request (a merge request on GitLab) |
| `checks-pass` | The pull request's head is HEAD, and its checks passed (a CI watch, or the checks `gh` or `glab` show) |
| `scenarios-pass` | Every numbered scenario of the approved plan passed, each with evidence |
| `you-approve` | You answer yes to moving on, in a dialog |

## Tool: `workflow`

| Action | Kind | What it does |
|---|---|---|
| `list` | read | The workflows defined, and the files that failed to load |
| `status` | read | The stage, what each exit condition still needs, the holds in force; without a ticket, all active work |
| `start` | local write | Starts a workflow for a ticket; replacing one needs `replace` and asks you |
| `bind` | local write | A worktree for a repository on the work's branch, added to the ticket's repositories |
| `submit_plan` | local write, asks | Checks `plan.md` and shows it for your approval, with a fingerprint |
| `test` | local write | Runs a bound repository's tests at HEAD, in the sandbox, and records the result |
| `scenario` | local write | Records pass or fail for one numbered scenario; a pass needs evidence |
| `advance` | local write | Moves one stage when every exit condition holds, or lists what is missing |
| `back` | local write | Moves to an earlier stage; always allowed, and nothing recorded is erased |

## Commands

| Command | What it does |
|---|---|
| `/workflow` | The status of this session's work |
| `/workflow list` | The workflows defined, and every file that failed to load, with the reason |
| `/workflow start [name] [ticket]` | Starts a workflow; replacing one says what is lost and asks |
| `/workflow reload` | Reads the workflow files again |

At session start, a line says which stage the active ticket is in and what is missing.

## Rules
- **Nothing is built in.** Workflows are read from files at session start and on `/workflow reload`.
- **One workflow per ticket.** Switching is an explicit `start` that lists what is lost; the old state is kept.
- **Holds go through `jig-core`.** The plugin registers a gate, which can only make a decision stricter
  (allow to ask or deny, ask to deny); the floor still applies ([Holds](docs/holds.md)).
- **Evidence is recorded against what it is about.** A new commit ends a test result, and an edited plan
  needs approving again ([State](docs/state.md)).
- **Setup failures and stage events.** A command that could not run tests says “tests did not run” and points at
  `workflow.tests`; a stage move publishes `jig:stage-done`. The old `submit-plan` name is accepted through 0.4.x.
- **Tests run in the sandbox.** Without `jig-sandbox`, or for a command set to run `outside`, a test run asks
  first, naming the command. A Gradle wrapper gets the JDK that fits ([Tests](docs/tests.md#the-jdk-of-a-gradle-build)).
- **The agent cannot mark anything passed.** It asks for a run, an approval or a check, and the plugin
  records the outcome in a file that Pi's file tools and the sandbox cannot write.
- **A broken file is reported, not guessed.** A file with an unknown field, condition or stage is skipped,
  and `/workflow list` names the file and the key.

## Configure

In `~/.pi/agent/jig.json`, under `workflow`. [Configuration](docs/configuration.md) has every field.
## Company part (in the company plugin)

- its workflow files, in a folder given through `config.addSectionDefaults("workflow", { folders })` (a user's
  own `folders` add to it), with their ticket key patterns and branch naming;
- its test commands per repository, through the same section defaults.

## Later

- **Check tiers,** a **checker agent**, a **review-comment ledger** and **one approval per change**
  ([Design](docs/design.md#where-this-comes-from)).

## Layout

- `index.ts`: the entry Pi loads; it hands on to `src/index.ts`.
- `src/`: the implementation, its checks and the parts it runs on.
- `skills/`: the skill text; read it before the first call.
- `test/`: the unit tests, fake hosts and real-program tests.
Every file: [Code map](docs/code-map.md).

## More detail

**Use it**
- [Files](docs/files.md): Read before you add a workflow.
- [Conditions](docs/conditions.md): Read before you add a condition.
- [Holds](docs/holds.md): Read before you hold a call.
- [Plan](docs/plan.md): Read before you approve a plan.
- [Tests](docs/tests.md): Read before you run tests.
- [State](docs/state.md): Read before you change state.

**Change it**
- [Code map](docs/code-map.md): Read before you change the code.
- [Design](docs/design.md): Read before you change the design.

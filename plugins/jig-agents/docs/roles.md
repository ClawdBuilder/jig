# Roles and agent files

A role narrows a child. Back to the [jig-agents README](../README.md).

A **role** is an agent file: Markdown with a few lines of front matter and a prompt. The one rule behind every
field is Codex's ([how the others do it](options.md#specialisation-compared-2026-11-01)):
**a role can only narrow what its child may do, never widen it, and the child enforces it.**

The parent hands the child its role's limits in one environment variable, and a gate in the child's own `jig-core`
refuses what the role does not allow. A gate can only make a decision stricter, so the child's usual rules and the
[floor](../../../docs/permissions.md) still apply on top. [Design](design.md#a-role-only-narrows-and-the-child-enforces-it)
says why this holds.

### An agent file

This file uses every field. Lines that start with `#` are comments.

```markdown
---
# The name defaults to the file name.
name: orders-fixer
# One line, which the parent agent reads when it chooses a role.
description: Fixes one bug in orders-api in a worktree of its own, tests it and reports
# The only tools the child has. A role that does not write must list them.
tools: read, write, edit, bash, git, grep, find, ls
# For a tool named here, only these actions run. A tool not named keeps all of its actions.
actions: git status|diff|log|show|commit|push
# These actions ask you even if the rules would allow them. They must be among the actions above.
ask: git push
# Whether the role may write. Default false; a role that writes works in a worktree of its own.
writes: true
# The skills the child sees: none, or exactly these. Left out, they follow the tools.
skills: git, orders-testing
# Skills whose whole text is in the child's instructions from the start. Each must also be in skills.
preload: orders-testing
# project (the default) or none: whether the child reads the project's AGENTS.md and CLAUDE.md.
context: project
# Pi's thinking level, if you want one. Configuration can replace it.
thinking: medium
---

You fix the one bug in the task, in this folder, and report. Change only what the fix needs.
```

The body is the role's prompt. There is no model and there are no limits in the file, so a public agent file never
names a company's model: they come from [configuration](configuration.md).

### Every field

| Field | Meaning | Default | Who may change it |
|---|---|---|---|
| `name` | Letters, digits, `-` and `_` | the file name | the file |
| `description` | One line for the parent agent | none, required | the file |
| `tools` | The tools the child has | the usual tools (a writer only) | the file |
| `actions` | For a tool named, the only actions that run | every action | the file; configuration narrows |
| `ask` | Tool actions that ask even if the rules allow | none | the file; configuration adds |
| `writes` | Whether the role may write | `false` | the file only |
| `skills` | `none`, or the skills the child sees | those that follow the tools | the file; configuration replaces |
| `preload` | Skills whose whole text starts in the instructions | none | the file; configuration replaces |
| `context` | `project` or `none` | `project` | the file; configuration replaces |
| `thinking` | Pi's thinking level | the model's own, else the parent's | the file; configuration replaces |
| `model`, limits, `approvals` | Not file fields: a file that names one is an error | the parent's, [limits](design.md#approvals-in-a-child) | configuration only |
| `extensions` | Not a field: a child always loads its parent's plugins | all of them | neither |

- **`actions` and `ask` are one line:** `actions: git status|log|diff, jira get|search`. A tool and an action are
  names, a tool must also be in `tools`, and a tool is named once.
- **Configuration can never widen.** `writes` is not a setting. A tool in both the file's `actions` and
  configuration's keeps the actions both list, so configuration cannot add `push`. Its `ask` adds to the file's.
- **A file of your own replaces a shipped role of the same name.** That is your file, in a place the model cannot
  write; it is not configuration, and it is what you use to change `writes` or `tools`.
- **A missing shipped folder is a broken install:** `jig doctor` fails and `loadRoles` names it. A missing folder of your
  own is fine.

### The roles that ship

| Role | May write | Tools | Git actions | For |
|---|---|---|---|---|
| `scout` | no | read, grep, find, ls, git, logs, bash | the reads: status, diff, log, show, blame, branches | Exploring code, logs and tickets, with evidence |
| `reviewer` | no | read, grep, find, ls, git, bash | the same reads: status, diff, log, show, blame, branches | Reviewing a diff or branch with fresh eyes |
| `worker` | yes | read, write, edit, bash, git, grep, find, ls | all; a push asks | One scoped change, in a worktree, tested |

- **A worker gets a worktree:** a new folder beside the repository, on a new branch, made through `jig-core`'s
  git. The report names the branch. `git push` asks by default, so the worker needs no `ask` line.
- **Read from three places:** the plugin's `agents/`, `agents.folders`, and `~/.jig/agents/`. Never from the
  project, because the model can write there. A bad file is skipped, and `/agents roles` names it and the field.
- **`/agents roles` shows the result:** per role, its tools, actions, ask, writes, skills (the list as it will be),
  preload, context, thinking, model and limits, and for each whether it came from the file or from configuration.

### Which skills a child sees

Pi lists every skill it knows to the model, so a child for a narrow job would carry the skills of tools it
cannot call. `skills:` is the choice, and when it is left out the skills **follow the tools**:

- **A skill that belongs to a plugin** is seen only when the role has a tool that plugin registers. Jig's own
  skills sit in `plugins/<plugin>/skills/`. A scout with `git` and `logs` sees the git and logs skills, and not the Jira or deploy ones.
- **A company skill says which tool it extends,** with the `metadata` field the Agent Skills format keeps for this, and
  Pi accepts:

  ```markdown
  ---
  name: acme-jira
  description: Acme's Jira rules on top of the jira skill. Use whenever the user names an ACME-123 key.
  metadata:
    jig-tool: jira
  ---
  ```

- **A skill with no known owner is always seen,** and so is every skill for a role with no `tools` list.
- **`preload`** puts a skill's whole text in the child's instructions at start, because a model may fail to load a
  skill it needs. The skill is also listed, as every preloaded skill must be.

The parent starts the child with `--no-skills` and one `--skill` for each skill it keeps, and with `--no-context-files`
for `context: none`.

### Read-only bash

A shell command can write, so `jig-core` calls every `bash` a write, and a role with `writes: false` could not have it.
A read-only role may list `bash` **when the child has `jig-sandbox`**.

In such a child the sandbox locks the working folder and the home folder, so a command reads them and writes neither;
`/tmp` stays writable for scratch files. The build caches in the home folder are locked too, so a read-only agent
cannot poison one.

- **Where there is no sandbox, the role is refused** at `start` and in `/agents roles`, with the way out.
- **`bash` with `outside: true`**, which runs outside the sandbox, is a different action and is refused.
- **`write` and `edit` stay forbidden** in a read-only role, and so do `powershell` and `notebook_edit`.

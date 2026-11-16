# How the agent learns Jig

A coding agent knows nothing about Jig until Pi tells it. Three things do that, and they cost different amounts of
context: the tools list, which is always in the prompt; the skills, which are advertised by name and loaded only when
the task calls for one; and the skill bodies themselves, which hold the workflow for one tool.

## The tools list

Most Jig tools carry a `promptSnippet`: one line that Pi puts in its `<tools>` section, so the model knows the tool exists
and what it is for. The line is written in the plugin, next to the tool, and a registered test caps its length — 100
characters in [`jig-git`](../plugins/jig-git/src/git.ts), 120 in [`jig-api`](../plugins/jig-api/src/tool.ts), 140 in
`jig-ops`. Pi leaves out a tool without one, so every tool that Jig adds for the model to choose carries one; `jig-review`'s two
tools are the exception.

The snippet is not a skill and does not replace one: it is a signpost, the length of a sentence, and it never explains
how to use the tool.

## The ten skills

A skill is a folder with a `SKILL.md` in it: front matter with a `name` and a `description`, then the instructions. Pi
lists every skill by name and description, then loads the body only when the work calls for it, so a skill can be long
without costing a turn.

| Skill | Plugin | Taught when |
|---|---|---|
| `api` | `jig-api` | a saved request is called or tested, or one is reproduced from a ticket |
| `ci` | `jig-ops` | a CI run is watched or read, or one is rerun or triggered |
| `git` | `jig-git` | any change goes to a branch, a commit, a push, a pull request or a release |
| `jira` | `jig-jira` | the user names an issue key, or asks for Jira work |
| `logs` | `jig-logs` | an error or a ticket sends the agent to a log search |
| `mongo` | `jig-mongo` | a MongoDB question, query or a change to test data |
| `ops` | `jig-ops` | a deploy, a rollout or a service's runtime state is read |
| `subagent` | `jig-agents` | work is handed to a child agent, or a role is chosen |
| `ticket-memory` | `jig-memory` | a ticket's notes, evidence or checks are written or closed |
| `workflow` | `jig-workflow` | a ticket has a workflow, a stage, or an exit condition to meet |

The folder is the unit Pi loads: `plugins/<plugin>/skills/<name>/SKILL.md`, and the root `package.json` lists
`plugins/*/skills` under `pi.skills`. The `description` is the routing information, so it says what the skill does and
when it applies; a description that only says "helps with X" is a bug.

## Overlays: a company's rules in a generic skill

A company plugin can add its own section to a generic skill without editing it: ship `overlays/<skill>.md`, plain
Markdown with no front matter, and `jig-core` merges it. For the active company it writes
`<state>/skills/<profile>/<skill>/SKILL.md` — the generic file unchanged, then a heading `## <Company> rules` and the
overlay's text — and copies the skill's other files beside it, so its relative links still resolve
([`overlays.ts`](../plugins/jig-core/src/overlays.ts)). Each turn the skill list points at that merged copy, so the
model sees one description and reads both texts in one file. A dormant company's skills are left out of the list.

The overlay is for conventions and facts, not for behaviour: a tool's behaviour is the same for every company
([Writing a company plugin](company-plugin.md)).

## How to see what the agent was told

- **The tools list** is Pi's `<tools>` section, built from the snippets. Pi's startup screen names the loaded tools and
  skills; `/jig` names the tools Jig governs and the plugins loaded, and `/jig rules` names the decision for every action.
- **The skills** are the ten `SKILL.md` files above, one per folder. A skill that a company overlays is the merged copy:
  read `<state>/skills/<profile>/<skill>/SKILL.md` to see exactly what the model got, heading and all. The state folder
  is `$JIG_STATE_DIR`, or `~/.local/state/jig`.
- **What the model reads in this repository** is also on disk: every `SKILL.md`, and the plugin READMEs they come from
  ([Plugins](plugins.md) is the map).

## The budget

A skill is worth writing when the tool needs a workflow: when to reach for it, which action first, what to check before
the next call. The skill folders are bounded on purpose — ten, one per tool that has a sequence — and the snippets stay
one line. The model pays for the list every turn and for a skill's body only when it opens it, so adding a skill is
cheaper than adding a paragraph to the prompt, and adding neither is cheapest of all.

Back to [the docs index](README.md).

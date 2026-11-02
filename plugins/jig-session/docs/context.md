# Context and requests

How `jig-session` counts what fills a session's context (`contextDetail`), and how it handles a reader's requests: the tool
and skill switches and the reload. A panel such as the Context panel of the [Herdr app files](../../../herdr/README.md) shows
the first and sends the second. The fields are specified in the [jig-session overview](../README.md#the-status-file).

## The breakdown

Pi reports one figure, the tokens in use. The parts come from what Pi would send next: the rendered system prompt and the tool
declarations. Each is counted in characters, exactly, and turned into tokens as characters / 4, rounded up: the estimate Pi
uses itself. A panel marks these with `≈`.

| Part | Counted from |
|---|---|
| `system` | Pi's rendered system prompt (`ctx.getSystemPrompt()`), less its context files and skills sections |
| `contextFiles` | The `project_context` section: each `<project_instructions path="…">` block and its wrapping |
| `skills` | Each skill that is on and listed: its name, description and path as Pi lists them, plus the list's frame |
| `tools` | Each active tool's declaration: its name, description and parameter schema, as JSON |
| `messages` | `used` less the four parts above, never below 0 |
| `reserve` | `compaction.reserveTokens` (the model's override first; 16384 by default), 0 with compaction off |
| `free` | `window` less `used` less `reserve`, never below 0 |

- **`used` and `usedFrom`:** after a reply, `used` is Pi's figure (`usedFrom: "pi"`): the last reply's usage, plus an
  estimate of what came after. Before the first reply Pi counts the messages only, so the parts are added to it
  (`usedFrom: "parts"`). After a compaction Pi does not know until the next reply, and `used`, `messages` and `free` are null.
- **Messages carries the error.** The provider's tokenizer counts JSON schemas at fewer characters per token than 4, and
  adds text of its own around the tools, so the four estimates run low and Messages shows the difference. On a new session
  with many tools this is several thousand tokens.
- **The lists:** `tools` holds every tool that can be declared (`exposure` other than `hidden`) with `on` and its
  declaration's size; `skills` every loaded skill with `on`, its size and `listed`, false for one Pi never lists to the
  model (`disable-model-invocation`); `files` each context file with its size.

## Requests

A reader writes `<state dir>/requests/<file name of the session>.json`, by a temporary file and a rename. Every 2 seconds the
session renames the file to a name of its own, reads it (at most 64 KiB) and removes it, so a newer request written meanwhile
is a new file, taken at the next look. Then it applies what it can and writes `lastRequest` into its status file.

- **Refused whole:** a file that is not JSON, not an object, not `schema: 1`, or whose `tools` or `skills` do not map names
  to `true` or `false`. `ok` is false and the message says why. Nothing changes.
- **Ignored:** a tool or skill name the session does not have, and a hidden tool. The answer names them; `ok` is false when
  nothing else was asked.
- **Applied:** the other switches. Each tool is checked after `pi.setActiveTools()`; one Pi kept as it was (an allowlist
  from `--tools`, say) is named. The switches are saved as a `jig-session.switches` entry in the session.
- **Nothing else.** A request cannot approve a call, answer a question or change jig-core's rules. Turning a tool on only
  declares it to the model; jig-core still decides each call, so a denied call stays denied.

A reader that sends a new request before the last is answered should carry the earlier switches too: the new file replaces
the old one if the session has not taken it yet. The Context panel does this.

## Skills, for one session

Pi has no setting for a skill in one session: the `skills` setting and its `-path` exclusions apply to every session of the
agent folder. `jig-session` uses Pi's `before_agent_start` event instead. Each turn's prompt options are a copy, so the
skills that are off are taken out of that copy's list. Pi then sends the skills section without them, as a patch to the
prompt the model has.

- **From the next turn, no reload.** A switch applies to the next turn of this session only. Other sessions, and the agent
  folder's settings, are untouched.
- **Saved in the session.** After a reload or a resume the entry brings the switches back.
- **What off means.** The model no longer sees the skill in its list. You can still type `/skill:<name>`, which loads it.

## Reload

Pi reloads only from a command (`ctx.reload()` exists on a command's context, not on an event's), and only while the agent is
idle. `jig-session` registers `/session-reload`, which waits for the agent and reloads. A `reload` request runs it with
`pi.sendUserMessage("/session-reload", { expandPromptTemplates: true })`, which dispatches a command and sends nothing to the
model:

1. **Idle:** at once, after the answer (`reload: "waiting"`) is written.
2. **Busy:** at `agent_settled`, as Pi's documentation shows for a reload asked by a tool.
3. **After:** the status file is kept through the reload. The new extension finds the answer it wrote, and marks it
   `reload: "done"`, with `; reloaded` at the end of the message.

[Back to the overview](../README.md)

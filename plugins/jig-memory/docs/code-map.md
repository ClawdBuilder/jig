# jig-memory: code map

Every file of `src/`, what it does and who calls it, and then one real call followed through the files.
Read it with the code open. Back to the [jig-memory overview](../README.md).

## The files

| File | What it does | Called by |
|---|---|---|
| `bm25.ts` | Keyword search over card text: words cut to a root, and BM25 (Robertson and… | `cards.ts`, `notes-index.ts`, `recall.ts` |
| `card.ts` | The card file: front matter that the plugin fills in, then three short… | `cards.ts`, `close.ts`, `material.ts` |
| `cards.ts` | The index of cards, `.cards.json` in the folder of all tickets: for each… | `recall.ts`, `session.ts` |
| `checks.ts` | Open checks: what the agent promised to do before the next step, such as… | `session.ts`, `tool.ts` |
| `clip.ts` | Cutting text by size. The limits are in bytes, because a file or a message… | `evidence.ts`, `message.ts`, `notes-index.ts` |
| `close.ts` | Closing a ticket: the plugin drafts card.md from the notes and evidence, the… | `session.ts` |
| `config.ts` | The `memory` section of jig.json: where ticket folders live, what a ticket… | `index.ts`, `session.ts` |
| `empty-files.ts` | Empty files in a ticket folder: a sign that a write was cut short. A machine… | `session.ts` |
| `evidence.ts` | Tool results while a ticket is active, kept as evidence. Each result is one… | `session.ts`, `tool.ts` |
| `extract.ts` | What a text names that another ticket's text could name too: ticket keys,… | `card.ts`, `cards.ts`, `material.ts` and 2 more |
| `index.ts` | Pi entry point of jig-memory. The factory only registers: the `memory`… || Pi |
| `material.ts` | What a ticket folder holds that a card or a recall query is made from: the… | `close.ts`, `session.ts` |
| `message.ts` | What the agent reads about a ticket in messages: the notes after activation… | `session.ts` |
| `notes-index.ts` | A search index of the tickets that have no card yet: the ## Now block and… | `recall.ts`, `session.ts` |
| `notes.ts` | notes.md: the template a new ticket starts from, and the ## Now block, which… | `empty-files.ts`, `material.ts`, `session.ts` and 1 more |
| `recall.ts` | Recall: which earlier tickets look like this one. Shared keys come first: a… | `session.ts` |
| `session.ts` | The active ticket, and what the agent is told about it. A ticket becomes… | `index.ts` |
| `store.ts` | The ticket folder on disk: <folder>/<KEY>/ holds notes.md (what is known,… | `cards.ts`, `checks.ts`, `close.ts` and 5 more |
| `tool.ts` | The `ticket` tool: the handoff record of the active ticket. Two things the… | `index.ts`, `session.ts` |

## One call: `ticket recall`

1. **The action.** `index.ts` registers the tool. `tool.ts` checks the action and query, and `session.ts` supplies the active ticket.
2. **The index.** `cards.ts` reads `.cards.json`; `notes-index.ts` adds derived notes entries; `bm25.ts` scores the query.
3. **The ranking.** `recall.ts` combines the sources, applies the threshold and writes the message.
4. **The answer.** `tool.ts` returns the recalled cards, and `session.ts` keeps the ticket state.

Back to the [jig-memory overview](../README.md).

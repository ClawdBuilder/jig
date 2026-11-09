# jig-lens: code map

Every file of `src/`, what it does and who calls it, and then one real call followed through the files.
Read it with the code open. Back to the [jig-lens overview](../README.md).

## The files

| File | What it does | Called by |
|---|---|---|
| `command.ts` | What the user typed after `/lens`, as a command. Parsing is separate from… | `lens.ts`, `scopes.ts`, `web.ts` |
| `compare-format.ts` | The comparison as text: one column for each condition. Like summary.ts this… | `lens.ts`, `scopes.ts` |
| `compare.ts` | `/lens compare`: how sessions under different conditions (the `condition`… | `compare-format.ts`, `scopes.ts` |
| `config.ts` | The `lens` section of jig.json: the viewers' port. jig-core checks the… | `deps.ts`, `index.ts`, `start.ts` and 1 more |
| `deps.ts` | What the commands use of the outside world. A test replaces the parts that… | `index.ts`, `lens.ts`, `start.ts` |
| `display.ts` | How the summary reaches the user, and why it never reaches the model. The… | `lens.ts` |
| `fields.ts` | The index tables. Each column of `call` and `turn` is a field of jig-core's… | `import.ts`, `parse.ts`, `store.ts` |
| `format.ts` | Numbers and text for what the commands say: amounts with their units, and… | `compare-format.ts`, `display.ts`, `lens.ts` and 3 more |
| `import.ts` | Importing: jig-core's record files into the index, a file at a time and a… | `lens.ts`, `report.ts` |
| `index.ts` | Pi entry point of jig-lens. The factory only registers: the `lens` section… || Pi |
| `lens.ts` | What jig-lens does in a session: agent_end imports the records that were… | `index.ts` |
| `parse.ts` | One line of a record file, as the values of one row. A line that is not a… | `import.ts` |
| `paths.ts` | Where jig-lens reads and writes. Everything it owns is below `<state>/lens`;… | `deps.ts`, `index.ts`, `start.ts` and 1 more |
| `period.ts` | Days as the person sees them. The index keeps UTC seconds, and a record file… | `compare-format.ts`, `scopes.ts`, `summary.ts` and 1 more |
| `programs.ts` | Finding programs on PATH, and opening a page in the user's browser. | `deps.ts`, `index.ts` |
| `queries.ts` | The questions the summary asks of the index, one function for each section.… | `compare.ts`, `scopes.ts`, `summary.ts` and 2 more |
| `report.ts` | What the commands tell the user. Plain sentences, built from what the… | `lens.ts`, `start.ts` |
| `scopes.ts` | What a command asks for: the scopes to summarise, and the blocks that come… | `lens.ts` |
| `session-file.ts` | One call's arguments and result, from Pi's own session file. The record… | `web.ts` |
| `start.ts` | Starting the viewer, and waiting until it answers. | `lens.ts` |
| `store.ts` | The index file: opening it for writing or for reading, deleting it for a… | `lens.ts`, `report.ts`, `web.ts` |
| `summary.ts` | The summary as text: what each section says, in short aligned lines. The… | `compare-format.ts`, `display.ts`, `lens.ts` and 1 more |
| `usage-dashboard.ts` | `/lens usage`: an interactive view of cost and tokens, from Pi's own session… || `lens.ts` (dynamic import) |
| `usage-history.ts` | The usage in Pi's session files, collected for `/lens usage`. Local only: it… | `usage-dashboard.ts`, `usage-names.ts`, `web.ts` |
| `usage-names.ts` | Names for the models in the usage view. A provider may record a model under… | `lens.ts`, `web.ts` |
| `usage-record.ts` | What one entry of a Pi session file says about usage: the model that… | `usage-history.ts` |
| `viewer.ts` | The viewer: the commands that start Grafana or Datasette, asking whether one… | `command.ts`, `deps.ts`, `index.ts` and 3 more |
| `web-queries.ts` | The questions the `/lens web` page asks of the index, beside the summary's… | `web.ts` |
| `web.ts` | `/lens web`: a small page over the index, served by this Pi session on… | `lens.ts` |

## One call: `/lens usage`

1. **The command.** `index.ts` registers `/lens`; `lens.ts` parses the words through `command.ts`.
2. **The scope.** `scopes.ts` resolves the period and filters, and `store.ts` finds the records index.
3. **The figures.** `queries.ts` reads the index through `store.ts`; `usage.ts` and `format.ts` count tokens and cost.
4. **The screen.** `usage-dashboard.ts` draws the view and `display.ts` puts it on the terminal, never in the model's context.
5. **The answer.** `lens.ts` returns when the view closes; the index is updated by `import.ts`.

Back to the [jig-lens overview](../README.md).

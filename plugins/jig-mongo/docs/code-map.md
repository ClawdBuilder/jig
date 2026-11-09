# jig-mongo: code map

Every file of `src/`, what it does and who calls it, and then one real call followed through the files.
Read it with the code open. Back to the [jig-mongo overview](../README.md).

## The files

| File | What it does | Called by |
|---|---|---|
| `access.ts` | What the agent may see. An environment has a deny list (everything is… | `config.ts`, `expr.ts`, `filter.ts` and 8 more |
| `backend.ts` | The seam between the tool and the MongoDB driver. The tool asks for what it… | `driver.ts`, `reads.ts`, `require-index.ts` and 3 more |
| `bson.ts` | What comes back from the driver, as plain JSON that never depends on driver… | `access.ts`, `reads.ts`, `render.ts` and 1 more |
| `config.ts` | The `mongo` section of jig.json: where each environment's database is, how… | `index.ts`, `route.ts`, `session.ts` and 1 more |
| `driver.ts` | The official MongoDB driver behind the Backend seam. `adaptClient` is the… | `tool.ts` |
| `ejson.ts` | Extended JSON as the model writes it: `{"$oid": "..."}`, `{"$date": "..."}`… | `bson.ts`, `driver.ts`, `expr.ts` and 3 more |
| `errors.ts` | Failures of the route and the server, and what to tell the model about each.… | `require-index.ts`, `route.ts`, `session.ts` and 1 more |
| `explain.ts` | The plan of a query, in a few lines: which index, how many documents were… | `reads.ts` |
| `expr.ts` | Aggregation expressions and the check every field reference goes through. A… | `filter.ts`, `pipeline.ts`, `reads.ts` and 1 more |
| `filter.ts` | A filter in the query language: `find`'s filter, `$match`, a `$lookup` that… | `pipeline.ts`, `reads.ts`, `write-check.ts` |
| `index.ts` | Pi entry point of jig-mongo. The factory only registers: the `mongo` section… || Pi |
| `params.ts` | The parameters of the `mongo` tool. One flat object, because several model… | `plan.ts`, `reads.ts`, `session.ts` and 2 more |
| `pipeline.ts` | An aggregation pipeline, walked in full before anything runs. Every… | `plan.ts`, `reads.ts`, `write-check.ts` and 1 more |
| `plan.ts` | A call, planned: checked against the access lists, and turned into something… | `tool.ts` |
| `reads.ts` | The actions that only read. Each is planned first, with nothing sent: the… | `plan.ts`, `writes.ts` |
| `render.ts` | What the model reads: a header line, then one line of JSON for each… | `explain.ts`, `reads.ts`, `writes.ts` |
| `require-index.ts` | The index check of a read. Where the environment requires it (production by… | `plan.ts`, `reads.ts` |
| `route.ts` | The route to a database that is not reachable directly: an SSH local forward… | `session.ts` |
| `session.ts` | Connections kept for the session: for each connection (one per environment,… | `tool.ts` |
| `tool.ts` | The `mongo` tool: what Pi registers, and the two functions that jig-core's… | `index.ts` |
| `values.ts` | Small helpers the modules share: the error that means "invalid input", and… | `access.ts`, `backend.ts`, `bson.ts` and 15 more |
| `write-check.ts` | The inputs of the actions that write: documents, updates, the operations of… | `writes.ts` |
| `writes.ts` | The actions that write. A write is planned first with nothing sent (the call… | `plan.ts`, `tool.ts` |

## One call: `mongo find`

1. **The action.** `index.ts` registers the tool. `tool.ts` parses with `parseCall` (`params.ts`) and checks `accessFor` (`config.ts`).
2. **The plan.** `planCall` (`plan.ts`) checks the filter and the names through `access.ts` and `filter.ts`, then plans the read.
3. **The connection.** `session.ts` finds the environment's route (`route.ts`) and `driver.ts` connects through the driver seam (`backend.ts`).
4. **The read.** `reads.ts` runs the find, with `require-index.ts` checking a production plan first and `ejson.ts`/`bson.ts` converting values.
5. **The answer.** `render.ts` writes the documents, `explain.ts` adds a plan when asked, and `tool.ts` returns the text.

Back to the [jig-mongo overview](../README.md).

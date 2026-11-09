# jig-logs: code map

Every file of `src/`, what it does and who calls it, and then one real call followed through the files.
Read it with the code open. Back to the [jig-logs overview](../README.md).

## The files

| File | What it does | Called by |
|---|---|---|
| `backends/backend.ts` | The seam between the shared search and the store that holds the logs.… | `backends/elasticsearch.ts`, `backends/index.ts`, `backends/loki.ts` and 2 more |
| `backends/elasticsearch.ts` | Elasticsearch and OpenSearch: `POST <url>/<index>/_search` with a JSON body.… | `backends/index.ts` |
| `backends/index.ts` | The backends that are built. Adding one is a file in this folder that… | `config.ts`, `params.ts`, `search.ts` and 2 more |
| `backends/logql.ts` | The parts of LogQL that Loki's adapter has to get exactly right: writing a… | `backends/loki.ts` |
| `backends/loki.ts` | Grafana Loki: `GET <url>/loki/api/v1/query_range`, with the LogQL query, the… | `backends/index.ts` |
| `clip.ts` | Shortening a log message for a hit line. jig-core masks production results… | `line.ts`, `summary.ts` |
| `config.ts` | The `logs` section of jig.json: where the search backend is, how to sign in… | `backends/backend.ts`, `backends/elasticsearch.ts`, `backends/index.ts` and 8 more |
| `failure.ts` | Why one request did not give a usable answer, and what to do about it. A… | `backends/backend.ts`, `backends/elasticsearch.ts`, `backends/loki.ts` and 3 more |
| `filter.ts` | The `filter` of an environment: fields of its documents (Elasticsearch) or… | `backends/elasticsearch.ts`, `backends/logql.ts`, `backends/loki.ts` |
| `index.ts` | jig-logs: log search for the agent. One tool, `logs`, that reads the logs of… || Pi |
| `line.ts` | One fetched hit as a line: its time and its message on one line, shortened… | `params.ts`, `summary.ts` |
| `params.ts` | What the `logs` tool accepts: the schema the model sees, the usage line that… | `tool.ts` |
| `query.ts` | What one `logs` call asks for, in terms every backend understands. A backend… | `backends/backend.ts`, `backends/elasticsearch.ts`, `backends/loki.ts` and 3 more |
| `request.ts` | The one request function. A search is one HTTP request that the backend's… | `search.ts`, `tool.ts` |
| `response.ts` | What a backend's reply is read into. Reading a reply is the backend's own… | `backends/backend.ts`, `backends/elasticsearch.ts`, `backends/loki.ts` and 3 more |
| `search.ts` | Runs one log query as a series of bounded requests and reports exactly what… | `summary.ts`, `tool.ts` |
| `summary.ts` | Turns a search outcome into the short plain text the model reads: a header,… | `params.ts`, `tool.ts` |
| `time.ts` | Time windows for log searches: reading them, checking them, and planning the… | `backends/backend.ts`, `backends/elasticsearch.ts`, `backends/loki.ts` and 5 more |
| `tool.ts` | The `logs` tool: search one environment's logs. It only reads. The tool says… | `index.ts` |
| `values.ts` | Small helpers shared by the files of this plugin. | `backends/elasticsearch.ts`, `backends/logql.ts`, `backends/loki.ts` and 7 more |

## One call: `logs search`

1. **The action.** `index.ts` registers the tools. `tool.ts` reads the call with `checkParams` and `resolveQuery` (`params.ts`).
2. **The target.** `targetFor` (`config.ts`) finds the environment's backend, and `backendOf` (`backends/index.ts`) picks Elasticsearch or Loki.
3. **The search.** `search.ts` splits the window into buckets and asks `request.ts` to send each; `backends/elasticsearch.ts` or `backends/loki.ts` builds the body or query.
4. **The lines.** `summary.ts` reads the replies and `line.ts` cuts one line per hit; `clip.ts` bounds long messages.
5. **The answer.** `summary.ts` writes the header and hits; `tool.ts` returns one text result.

Back to the [jig-logs overview](../README.md).

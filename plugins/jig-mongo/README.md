# jig-mongo: MongoDB, with reads, writes, indexes and aggregation

**Status: built.** A complete MongoDB tool, with reads and writes governed by `jig-core`.

`jig-mongo` gives the agent a complete MongoDB tool: exploring, querying, indexes, query plans, aggregation and writes.
`jig-core` decides each call by environment: reads run, a write to `staging` asks you with a preview, and every write to
production is denied. What the agent may see is set by an allow list or a deny list.

For example, to debug a stuck order the agent runs `count`, then `find` on `orders.orders` in `staging`. It then runs `explain`
to see whether the query used an index, and `update` to fix the test document, after you approve the preview.

![A mongo call: jig-core decides by environment, the field walk checks every field against the access lists and refuses a denied one, the route opens the environment's connection, MongoDB answers, and the rows come back with denied fields stripped and production masked](../../docs/img/mongo-walk.svg)

*How a call is checked and run. `jig-core` decides by environment: a read runs, a test write asks with a count, a production
write is denied. The walk then checks every field in every stage against the lists and refuses a denied or unlisted one
before anything runs; with an allow list it also puts a projection of the allowed fields in front of every stage. The route
opens the environment's connection, and the rows come back with denied fields stripped at any depth. [Access](docs/access.md)
has the lists, [Writes](docs/writes.md) the guards on writes, and the routes are in [Configuration](docs/configuration.md).*

## Tool: `mongo`

| Group | Action | Kind | What it does |
|---|---|---|---|
| Access | `access` | read | Per environment and cluster: the mode and the configured deny/allow names; a deny list means everything not named is allowed |
| Explore | `databases`, `collections` | read | What exists, minus everything denied |
| | `schema` | read | Field names and types, from a sample |
| | `stats` | read | Sizes and counts of a collection or database |
| Indexes | `indexes` | read | The indexes of a collection |
| | `index_stats` | read | How often each index is used (`$indexStats`) |
| | `explain` | read | The plan of a query: which index, documents examined, time |
| Query | `count`, `find`, `distinct`, `sample` | read | Documents, with filter, projection, sort and limit |
| Aggregation | `aggregate` | read, or write | The full pipeline. With `$out` or `$merge` it is a write |
| Write | `insert`, `update`, `replace`, `delete`, `bulk` | write | Changes documents. `update` and `delete` take `one` or `many` |
| Index changes | `create_index`, `drop_index` | write | Changes indexes |

Filters, documents and pipelines are Extended JSON, such as `{"$oid": "..."}`, and so are the results, so an `_id` from one
call can be used in the next. A result that reaches its limit (1 to 2000, default 20) is marked "possibly partial".
Parameters and results: [Results](docs/results.md).

## Access: an allow list or a deny list

| | Test environments | Production |
|---|---|---|
| Default | **Deny list:** everything is readable except what you list | **Allow list:** nothing is readable until you list it |
| Why | Test data is there to be explored | A new sensitive collection is never shown by accident |

- **Always denied, in every environment:** the databases `admin`, `local` and `config`, `system.*` collections, and fields whose
  names look like credentials (`*password*`, `*secret*`, `*token*`, `*apiKey*`, in any case). You can add to these, never remove them.
- **Lists reach fields, not only collections.**
  - `find` and `sample` strip denied fields from every result, at any depth. In production they return only allowed fields, as a
    forced projection.
  - `aggregate` is refused before it runs when it names a denied field anywhere: a rename such as `{ x: "$password" }`,
    `$getField`, a `$lookup`, `$graphLookup` or `$unionWith` into a denied collection, `$replaceRoot`, a `$facet` branch.
  - With an allow list a projection of the allowed fields is also put in front of every stage ([Access](docs/access.md)).
- **A denied collection cannot be written either.**

## Rules

- **Writes are previewed with a count and never resent.** [Approvals](../../docs/approvals.md#preview-digest-and-a-lost-reply)
  has the digest rule; the count is read again just before the write.
- **Guards on writes:** an `update` or `delete` with an empty filter is refused; `many` above 1000 documents needs a `limit` you
  raise on purpose ([Writes](docs/writes.md)).
- **Production reads must use an index.** Before a `find`, `count`, `distinct` or `aggregate` runs there, the planner is asked
  how it would run (nothing is executed), and a plan that scans the collection is refused, naming the fields an index leads
  with ([Index check](docs/index-check.md)).
- **Server-side JavaScript is refused** (`$where`, `$function`, `$accumulator`), unless you allow it for a test environment.
- **Production is read-only and masked,** whatever the configuration says: `jig-core`'s floor denies a production write, and the
  tool refuses it again when it plans the call. `jig-core` masks every production result.

## Configure

In `~/.jig/jig.json`, under `mongo`. [Configuration](docs/configuration.md) has every field.
## Company part (in the company plugin)

- its connections and routes, such as a tunnel through its own jump hosts. Your `mongo` section is laid
  over them, so you add only your `user` and `password`; a `via` of yours replaces the company's whole;
- its allow lists for production;
- credentials, as secret references.

## Later

- **Saved queries,** run by name, for queries a team wants to share.
- **Change streams,** watching a collection for a while.
- **Upserts and array filters** in `update`.

## Layout

- `index.ts`: the entry Pi loads; it hands on to `src/index.ts`.
- `src/`: the implementation, its checks and the parts it runs on.
- `skills/`: the skill text; read it before the first call.
- `test/`: the unit tests, fake hosts and real-program tests.

Every file: [Code map](docs/code-map.md).
## More detail

**Use it**
- [Access](docs/access.md): Read before you allow a collection.
- [Index check](docs/index-check.md): Read before a production read.
- [Results](docs/results.md): Read when a result surprises you.
- [Writes](docs/writes.md): Read before a write asks.

**Set it up**
- [Configuration](docs/configuration.md): Read before you add settings.
- [Connections](docs/connections.md): Read before you add a connection.

**Trust it**
- [Not verified](docs/not-verified.md): Read before you rely on it.

# jig-mongo: MongoDB, with reads, writes, indexes and aggregation

**Status: built.** A complete MongoDB tool, with reads and writes governed by `jig-core`.

`jig-mongo` gives the agent a complete MongoDB tool: exploring, querying, indexes, query plans, aggregation and writes.
`jig-core` decides each call by environment: reads run, a write to `staging` asks you with a preview, and every write to
production is denied. What the agent may see is set by an allow list or a deny list.

For example, to debug a stuck order the agent runs `count`, then `find` on `orders.orders` in `staging`. It then runs `explain`
to see whether the query used an index, and `update` to fix the test document, after you approve the preview.

![How a jig-mongo call runs: jig-core decides by environment, the walk checks every field against the access lists, an allow list also reshapes the call, the route reaches MongoDB, and denied fields are stripped from the rows](../../docs/img/mongo-walk.svg)

*How a call is checked and run. `jig-core` decides by environment, then the walk checks every field against the lists and refuses a denied one before anything runs. An allow list also reshapes the call, the route reaches MongoDB, and denied fields are stripped from the rows.*

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

In `~/.pi/agent/jig.json`, under `mongo`. An unknown field is an error, and the tool then does nothing until the file is fixed
(`/jig` lists the problems).

```json
{
  "mongo": {
    "connections": {
      "staging":    { "uri": "mongodb://db.staging.example.com:27017", "user": "agent", "password": "pass:mongo/staging" },
      "production": { "uri": "mongodb://db.example.com:27017", "user": "agent-readonly", "password": "pass:mongo/production",
                      "via": { "ssh": { "host": "bastion.example.com", "user": "agent", "key": "pass:ssh/bastion" } } }
    },
    "access": {
      "staging":    { "deny":  ["billing.cards", "*.notes"] },
      "production": { "allow": { "orders.orders": ["_id", "status", "items", "createdAt"] } }
    }
  }
}
```

| Field | Meaning |
|---|---|
| `connections` | Per environment: one connection, or named ones, each with `uri`, `user`, `password` and more |
| `via` | An SSH forward, or a company tunnel, as a forward or a SOCKS proxy ([Connections](docs/connections.md)) |
| `access` | Per environment, or per connection where there are several: `deny` or `allow` |
| `requireIndex` | Per connection: `true` or `false`. Default: on for production, off for a test environment |

- **`uri`** holds no credentials: one that has them is refused. **`password`** is a secret reference. **`user`** is a name, or a
  secret reference such as `pass:mongo/staging-user`.
- **`via`** is `{ "ssh": { host, user, key, port? } }`, with `key` a secret reference, or `{ "tunnel": "<name>" }`.
  - A SOCKS tunnel reaches every member of a replica set or `mongodb+srv` address.
  - An SSH forward or a forward tunnel reaches one host.
- **Several connections in one environment** (`orders` and `billing` in `staging`): give it a map of names.
  - The tool then takes a `cluster`, required there and refused elsewhere.
  - The environment still decides the rules ([Connections](docs/connections.md#several-connections-in-one-environment)).
- **`deny`** is a list of `db.collection`, `db.*`, `*.field` or `db.collection.field`. Production must use `allow`; anything else
  is an error.
- **`javascript: true`** allows server-side JavaScript in a test environment.
- **`requireIndex: false`** on a production connection is your decision, never the agent's, and `/jig` shows it. A small
  collection of an `allow` list can be marked `{ "fields": [...], "reference": true }` and is then read whole
  ([Index check](docs/index-check.md)).
Use a read-only database user for production. The floor denies writes anyway, but the user is the second lock.

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

**Set it up**
- [Connections](docs/connections.md): Read before you add a connection.

**Trust it**
- [Writes](docs/writes.md): Read before a write asks.
- [Not verified yet](docs/not-verified.md): Read before you rely on it.
- [Refusals](docs/refusals.md): Read when a call is refused.

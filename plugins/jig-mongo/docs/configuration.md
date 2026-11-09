# Configuration: the `mongo` section

The fields of the `mongo` section of `jig.json`. Back to the [jig-mongo overview](../README.md).

## The fields

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
| `via` | An SSH forward, or a company tunnel, as a forward or a SOCKS proxy ([Connections](connections.md)) |
| `access` | Per environment, or per connection where there are several: `deny` or `allow` |
| `requireIndex` | Per connection: `true` or `false`. Default: on for production, off for a test environment |

- **`uri`** holds no credentials: one that has them is refused. **`password`** is a secret reference. **`user`** is a name, or a
  secret reference such as `pass:mongo/staging-user`.
- **`via`** is `{ "ssh": { host, user, key, port? } }`, with `key` a secret reference, or `{ "tunnel": "<name>" }`.
  - A SOCKS tunnel reaches every member of a replica set or `mongodb+srv` address.
  - An SSH forward or a forward tunnel reaches one host.
- **Several connections in one environment** (`orders` and `billing` in `staging`): give it a map of names.
  - The tool then takes a `cluster`, required there and refused elsewhere.
  - The environment still decides the rules ([Connections](connections.md#several-connections-in-one-environment)).
- **`deny`** is a list of `db.collection`, `db.*`, `*.field` or `db.collection.field`. Production must use `allow`; anything else
  is an error.
- **`javascript: true`** allows server-side JavaScript in a test environment.
- **`requireIndex: false`** on a production connection is your decision, never the agent's, and `/jig` shows it. A small
  collection of an `allow` list can be marked `{ "fields": [...], "reference": true }` and is then read whole
  ([Index check](index-check.md)).
Use a read-only database user for production. The floor denies writes anyway, but the user is the second lock.

Back to the [jig-mongo overview](../README.md).

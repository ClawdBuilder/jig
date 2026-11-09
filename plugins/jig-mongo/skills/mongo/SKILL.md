---
name: mongo
description: MongoDB (mongo tool) - count before find, explain a slow query, change test data after a preview; production is read-only. Use for questions about data in MongoDB, a slow query, or fixing test data.
---

# Looking at MongoDB, and changing it in a test environment

Use the `mongo` tool for every MongoDB question. It connects as the user configured, hides what the access lists hide, and asks the user before it writes. A read runs at once. A write to a test environment shows the user a preview first. A write to production is refused, always.

## Environments with several connections

Some environments have more than one cluster, such as `orders` and `billing` in `staging`. Then every call needs `cluster` next to `environment`. The tool says so when it is missing and names the choices; an environment with one connection refuses `cluster`. The rules are those of the environment (a write to production is refused whatever the cluster), and a result names the connection as `staging/orders`. Ask the user which cluster if the question does not say.

## Start by looking

1. `access` lists each environment's allowed or denied names; read it before you guess one. Then `databases`, and
   `collections` for a database, show what exists. A name that is denied or not allowed is refused with what is allowed.
2. `schema` shows the field names and types of a collection from a sample. Use it before you write a filter, so the field names are real.
3. `indexes` shows what a query can use. `stats` shows how big a collection is.

## Count before you find

- `count` with your filter first. It is exact and cheap. If it says 40000, narrow the filter before you `find`.
- `find` with a small `limit`, and a `projection` of the fields you need. A result at its limit says "possibly partial": narrow the filter or raise `limit`, do not assume you saw everything.
- Ids and dates in a result are Extended JSON, such as `{"$oid": "..."}`. Copy them as they are into the next filter. A plain string will not match an ObjectId.
- `distinct` lists the values of a field. `sample` shows a few random documents. `aggregate` runs a pipeline when a filter cannot say it.

## Explain before you blame the database

A slow query is usually a missing index. Run `explain` with the same filter and sort. `COLLSCAN` means the whole collection was read; `IXSCAN(name)` means an index was used. Compare the documents examined with the documents returned: a big gap means the index does not fit the filter. Check `indexes` before you suggest a new one, and say what you found rather than "the database is slow".

## In production a read must use an index

Before a `find`, `count`, `distinct` or `aggregate` runs in production, the tool asks the planner how it would run, and refuses a plan that scans the whole collection. The refusal names the fields an index leads with. Rewrite the query to filter on one of them, or add a `$match` on one at the start of the pipeline. Do not retry the same query.

- `count` with no filter is refused. Use `stats` for the size of a collection, or a filter on an indexed field.
- To see what documents look like, use `sample`. A `find` with no filter is a scan.
- `explain` with the default `executionStats` runs the query, so it is refused the same way. Use `verbosity: "queryPlanner"` to see a plan without running it.
- A small reference collection may be exempt. If a read is refused and you think the collection is small reference data, say so to the user. Do not look for another way in: changing the setting is the user's choice.

## What you will not see

Fields whose names look like credentials (password, secret, token, apiKey) are never returned and cannot be named, in any environment. The user's lists hide more. In production only the listed fields exist: you get nothing else, and a pipeline that names another field is refused. A refusal names what is allowed. Use that list, and do not try to reach a hidden field by renaming it, `$getField`, `$lookup` or `$replaceRoot`: the same check applies.

## Changing test data

1. Read first: `count` and `find` the documents you mean to change.
2. Say what you are about to change, and why. Then make one write: `update`, `replace`, `delete`, `insert`, `bulk`, `create_index` or `drop_index`.
3. The user sees a preview with the filter, the change and how many documents match, counted just before. Make the filter as narrow as the task needs, usually an `_id`.
4. Use `which: "one"` unless the task is a real change to many. A filter that is empty is refused. More than 1000 documents is refused unless you raise `limit` on purpose.
5. After the write, read the document again and check the change.

If the tool says "changed since the preview", the count moved while the user read it. Nothing was sent. Look again and make the write again.

If a write ends with "no answer" or "the outcome is unknown", the tool did not send it again, and neither must you. Read the data first. The message tells you what it read.

## Never production

A write, an index change, `$out` and `$merge` are refused in production before anyone is asked. Do not look for another way. If production data needs fixing, write down the exact filter and change for a person to run, and say that you did not run it.

## When the tool refuses

The reason names what to change. [Refusals](../../docs/refusals.md) lists the common ones.

## Example

```json
{"action":"count","environment":"staging","collection":"orders","filter":{"status":"open"}}
{"action":"find","environment":"staging","collection":"orders","filter":{"_id":"order-123"},"limit":1}
```

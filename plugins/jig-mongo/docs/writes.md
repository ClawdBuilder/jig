# Writes

How a write is previewed, compared with what was approved, sent once, and checked when its reply is lost. Back to the
[jig-mongo overview](../README.md).

## Where a write may happen

| Environment | What happens |
|---|---|
| a test environment | `jig-core` asks, with the preview below |
| production | denied by `jig-core`'s floor, which no rule reaches past, and refused again by the tool when it plans the call |

A write is `insert`, `update`, `replace`, `delete`, `bulk`, `create_index`, `drop_index`, and an `aggregate` whose last stage is `$out`
or `$merge`. Nothing in a write is sent until the call has been planned: the collection, every field it names and every operator are
checked first, and an invalid call is blocked without asking.

## The preview

| Action | The preview shows |
|---|---|
| `update`, `replace`, `delete` | the filter, the change, how many documents match now, and the cap |
| `insert` | the first 10 documents and how many more |
| `bulk` | the operations, and for each one how many documents match |
| `aggregate` with `$out` or `$merge` | the pipeline, and how many documents reach the output and the target |
| `create_index`, `drop_index` | the keys and options, or the index and its definition, and the indexes there are |

- **`update`, `replace` and `delete`** count the documents just before the preview, and also show what the write changes.
- **`aggregate` with `$out` or `$merge`:** `$out` replaces the target, so the preview says how many documents it has now.

The count is `countDocuments` with a limit one past the cap, so a huge collection is not counted whole. The preview has a fingerprint
(a SHA-256 of the request and every count). It is read back with `approvedPreview` when the call runs.

## Changed since the preview and a lost reply

The digest rule is in [Approvals](../../../docs/approvals.md#preview-digest-and-a-lost-reply).
The count is read again just before the write; a changed fingerprint sends
nothing. A write is sent once.

## Guards

- **An empty filter** in `update`, `replace`, `delete` or a bulk operation is refused: it would change every document.
- **The cap:** `which: "many"` may touch 1000 documents. `limit` raises it on purpose, up to 2000, and lowers it too: it is the most the
  write may touch.
  - A filter that matches more is refused, and so is a `bulk` whose operations together touch more, an `insert` of more documents,
    and an `$out` or `$merge` that writes more.
  - `limit` with `which: "one"` is refused.
- **A filter that matches nothing** is refused: there is nothing to approve.
- **Not supported:** upserts, array filters and collations. A bulk operation or an `update` that names them is refused.

## The write is sent once

The rule is in [Approvals](../../../docs/approvals.md#preview-digest-and-a-lost-reply).
After a lost reply the tool reads once; the read depends on the write:

| Write | The read |
|---|---|
| `insert` | how many of the inserted documents are present, by `_id` |
| `update`, `replace`, `delete` | how many documents the filter matches now, against how many matched before |
| `bulk` | the same, for each operation that has a filter (at most 10) |
| `$out`, `$merge` | how many documents the target has now |
| `create_index`, `drop_index` | the names of the indexes now |

If that read fails too, the message says so and tells the model to read the
data. Either way the model must not send the write again without looking.

## The record

`jig-core`'s record of the call gets the facts `matched`, `modified`, `deleted` and `inserted`, whichever apply, and for a read
`returned` or `matched`. Never a document.

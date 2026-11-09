# When the mongo tool refuses

The reason names what to change. Back to the [jig-mongo README](../README.md).

The reason names what to change. The common ones:

- `X is not in the allow list` or `X is denied by the access list`: that collection or field is not for you. Use what the message lists.
- `refused, the plan scans the whole collection` or `... must use an index`: filter on a field the message names.
- `the index check could not be made`: nothing was read. The database user may not run `explain`, or the route failed. Say so once, and do not retry blindly.
- `looks like a credential`: a field with that name is always denied. Leave it out.
- `the filter is empty, so it would change every document`: say which documents.
- `the filter matches more than 1000 documents`: narrow the filter, or raise `limit` if you mean it.
- `runs JavaScript on the server`: `$where`, `$function` and `$accumulator` are not allowed. Use a filter or pipeline operators.
- `no tunnel provider is registered`, `the tunnel ... could not be opened`, `the bastion refused the SSH key`, `cannot reach the ... database`: the route is the user's to fix. Say so once, and do not retry blindly.
- `X has several connections: add cluster` or `X has one connection, so cluster is not used there`: use the names the message lists, or leave `cluster` out.

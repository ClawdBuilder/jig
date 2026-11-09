# Writes: previews, and lost replies

What you see before a call that asks, what stops it if anything changed, and what the tool does when no reply comes. Back to the
[jig-api overview](../README.md).

## What you see before a call asks

A call that asks shows the request and its environment, how it signs in, the method, the full address, the headers and the body, with
every variable filled in except the secrets and the values made at the moment of sending.

```text
Request: Create order (orders) in Staging (staging)
Sign-in: a bearer token, added by the tool
Method: POST
URL: https://api.staging.example.com/v1/orders
Headers:
  Content-Type: application/json
  Idempotency-Key: {{$uuid}}
Body (JSON, 44 bytes):
{
  "customerId": "cust-1",
  "sku": "W-1"
}
Secrets, read when it is sent and never shown: token
Made when it is sent: $uuid
```

- **The sign-in is named and never shown.** It reads `none`, `a bearer token`, `a user name and password (HTTP Basic)`,
  `an API key in the <name> header`, `an OAuth token (client credentials)`, `sign-in service "<name>"` or `transport "<name>"`.
  - For all but the first, it adds `added by the tool`.
  - No reference, token or address of a sign-in is in the preview.
- **A secret is shown by the name of its variable.** `{{token}}` where it is used, and a line that lists them. The preview reads no
  secret; the value is read when the request is sent.
- **A file is shown by its name, size and digest,** never its content.
- **A long body is cut, and the whole body is sent.** After 200 lines a note says how many lines are not shown. The summary line is the
  method and the full address, cut at 300 characters; the address is whole in the body.
- **A folder is one preview:** each request in order, approved once.
- **The preview contacts nothing and reads no secret.** It is made from the call, the collections' files and the configuration alone.

A call that does not ask, such as a read by default, has no preview. A rule that makes a read ask gives it a preview, and the guard
below applies to it too.

## Changed since the preview, and a lost reply

The rule is in [Approvals](../../../docs/approvals.md#preview-digest-and-a-lost-reply).
API compares:
- the collection, the request, its environment and `jig-core`'s name for it;
- how it signs in (the kind, and the name of a service or a transport);
- the secrets it uses with their references (never their values);
- the method, the full address, the headers, the body and the digest of every file in it.

A generated value is a mark, so it is the same at the preview and at the send.
Header names are compared in lower case and in any order. The timeout is left
out, because it changes how long the tool waits and not what it sends.

A read can be sent again after a lost reply; a write never is. The result says
whether nothing was sent, whether the outcome is unknown, or that the read can
be retried.

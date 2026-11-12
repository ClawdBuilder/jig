# Relay protocol, version 1

A **relay** is a program that holds a person's session for a company's systems and makes HTTP requests for Jig. It may
be a browser extension with a local host on the person's machine, a company server, or anything else that can listen at
an address. Jig talks to it through this small JSON protocol. The relay decides how it signs in to the systems; Jig
never sees a session, password or token for them.

The protocol number is **1**. The number in the path (`/v1/`) and the `protocol` field in a request or answer are always
the same number. A version 2 would live under `/v2/`.

## Address and authentication

The relay has one base address, such as `http://127.0.0.1:8700` or `https://relay.example.com`. Plain `http` is allowed
only for `127.0.0.1`, `localhost` and `[::1]`; every other address must use `https`. The address has no user name,
password, path, query or fragment.

Every request to `/v1/request` carries exactly one credential:

```http
Authorization: Bearer <token>
```

The token is Jig's token for the relay, not a company credential. The client label is the body field `client`; it is
not a header. A relay should refuse a request with no token, more than one token header, or a token it does not know.

## Health

```http
GET <base>/v1/health
```

Health may be called without a token. A healthy relay answers `200` with at least:

```json
{
  "ok": true,
  "protocol": 1,
  "service": "orders-api relay",
  "services": { "jira": true, "logs": false }
}
```

- `ok` says the relay is running.
- `protocol` is the version of this protocol it speaks.
- `service` is the relay's own name, used only in messages.
- `services` says which services the person has turned on. It is present when the token is sent; a relay may also send
  it without a token for older clients.

Other fields are allowed and ignored. A client refuses a `protocol` it does not know and names the versions it knows.
A wrong token on health is `401` with a `refused` answer, so a client can check the token without sending a request.

## Request

```http
POST <base>/v1/request
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "protocol": 1,
  "id": "4f3c2a9e-8d71-4c55-9b0a-1d2e3f405162",
  "client": "jig",
  "service": "jira",
  "method": "GET",
  "url": "https://jira.example.com/rest/api/2/issue/ABC-1?fields=summary",
  "headers": { "accept": "application/json" },
  "maxBytes": 8388608,
  "timeoutMs": 30000
}
```

| Field | Meaning |
|---|---|
| `protocol` | Always `1` in this version. |
| `id` | A UUID the client makes. It comes back in the answer and in the relay's own log. |
| `client` | The client's label: up to 64 of `A-Z a-z 0-9 . _ : / -`. Default `jig`. |
| `service` | Which of the relay's services to use, such as `jira` or `logs`. |
| `method` | `GET`, `POST`, `PUT`, `PATCH` or `DELETE`. |
| `url` | The full address of the site request. |
| `headers` | Only `accept` and `content-type`. The relay sets every other header itself, including the sign-in. |
| `body` | Text, absent on `GET`. |
| `maxBytes` | Required. The most reply bytes to read, from 1 to 16 MiB. |
| `timeoutMs` | Required. How long the site request may take, from 1,000 to 120,000 ms. |
| other fields | Extra fields for one service, such as a tenant. A relay refuses one it does not know. |

A relay **never follows a redirect for the client**. It may return the `3xx` as a `response`, refuse a redirected read
with `OUTSIDE_LIMITS`, or answer `unknown` with `REDIRECTED` for a redirected write; the client never sends the request
to the `Location` itself. A request field the relay does not know is refused, with `INVALID_REQUEST`; it is never
ignored.

## Answer

The relay answers `200` with exactly one of three outcomes. A `200` answer repeats the request's `id` and `protocol`; an
answer with any other status may leave `id` out when the relay could not read the request.

### `response`: the site answered

```json
{
  "protocol": 1,
  "id": "4f3c2a9e-8d71-4c55-9b0a-1d2e3f405162",
  "outcome": "response",
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": "{\"key\":\"ABC-1\"}",
  "truncated": false
}
```

`status` is the site's status. `headers` are the site's headers, or the subset the relay passes; never cookies or
credentials. Names are in lower case; each value is a string, or a list of strings for a header the site sent more than
once. `body` is text. `truncated` says the relay stopped at `maxBytes`; the client must not assume the body is complete.

### `refused`: no reply, and the site was not changed

```json
{
  "protocol": 1,
  "id": "4f3c2a9e-8d71-4c55-9b0a-1d2e3f405162",
  "outcome": "refused",
  "code": "SIGN_IN_REQUIRED",
  "status": 401,
  "message": "sign in to Jira in the relay"
}
```

**The site was not changed by this request**, so a client may send it again safely. This does not promise that nothing
left the relay: it may have sent a read and thrown the answer away, for example. `status` is a hint for the HTTP-shaped
reply.

### `unknown`: the request may have reached the site

```json
{
  "protocol": 1,
  "id": "4f3c2a9e-8d71-4c55-9b0a-1d2e3f405162",
  "outcome": "unknown",
  "code": "TIMEOUT",
  "message": "the site did not answer in time"
}
```

The request may have reached the site, and a write may have happened. The client treats this as a lost reply: it reads
the site once before saying whether the write happened, and never sends the same request twice.

### Messages and codes

`message` is one line, at most 300 characters. It holds no token, cookie, credential or reply body. A client shows it
to the person, so it should say what to do.

The relay's codes are its own. The protocol names these six for a client that acts on them:

| Code | The client reads it as |
|---|---|
| `SIGN_IN_REQUIRED` | The person must sign in to the relay or the service. |
| `SERVICE_OFF` | The service is off or not set up in the relay; show the relay's message, which says how to fix it. |
| `PAUSED` | The relay is paused, usually by the person. |
| `BUSY` | The relay cannot take this request now; retrying later may work. |
| `OUTSIDE_LIMITS` | The request, service or tenant is outside what this relay allows. |
| `INVALID_REQUEST` | The relay could not read the request; nothing was changed. |

A relay may use other codes. A client must treat an unknown code as a refusal when the outcome is `refused`, and as a
lost reply when the outcome is `unknown`.

## A status other than 200

A status other than `200` means the relay could not read the request at all. It answers with the `refused` body. The
`id` is absent or `null` when the relay could not parse the request:

```json
{
  "protocol": 1,
  "id": "4f3c2a9e-8d71-4c55-9b0a-1d2e3f405162",
  "outcome": "refused",
  "code": "UNAUTHORIZED",
  "status": 401,
  "message": "the relay token is missing or wrong"
}
```

Nothing was changed. A `401` on health means the token is wrong. A malformed answer, or one with an unknown protocol,
is a protocol error: the client says the relay did not answer correctly and changes nothing.

## Why not a plain HTTP proxy?

A proxy that only forwards requests cannot tell **"refused, nothing was sent"** from **"sent, the answer was lost"**.
For a read the difference is small; for a write it is the difference between retrying safely and repeating a change.
This protocol makes that distinction part of the answer (`refused` or `unknown`), and keeps the request's `id` so the
relay's log and the client's message can be matched.

## Fixtures

The request and answer pairs in [relay-protocol/fixtures.json](relay-protocol/fixtures.json) are examples a relay's
own tests can copy. Only `outcome`, `code` and `id` are exact; `status` and `message` are examples, so a relay may use
its own status and wording. Jig's tests do not depend on a fixture's status or message. They cover the three outcomes, every listed code, a `401`, a malformed answer, a service turned
off with its own fix, and a health answer with an unknown protocol.

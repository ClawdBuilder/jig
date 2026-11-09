# Not verified

What the tests of `jig-api` do not cover. Back to the [jig-api overview](../README.md).

The tests in `test/` use fixtures written from the formats' documentation and fake services on this machine, over plain `http` through
`allowPlainLocal`. The tests in `test/it/` run the tool against a real HTTP server and a real OAuth server, in the `integration` job of
CI (see [Integration tests](../../../docs/integration-tests.md)).

## Verified in CI

go-httpbin 2.26 answers every request with what it received. Keycloak 26.8, in dev mode, serves a realm imported from `test/it/keycloak/realm.json`.

| Area | How |
|---|---|
| Postman, `.http`, Bruno (YAML and `.bru`) and OpenAPI (YAML and JSON) fixtures run by name: the path filled, the sign-in added and removed from the answer, a JSON body, DELETE | `httpbin.test.ts` |
| A form body, a file uploaded as a multipart part and a file sent as the whole body, from Postman and Bruno | `httpbin.test.ts` |
| Every method, a JSON body with escapes and non-ASCII text untouched, headers, query strings | `httpbin.test.ts` |
| A redirect not followed, a cookie dropped and not sent back, a status that is not 2xx, a write that got a 5xx | `httpbin.test.ts` |
| A slow server, gzip, HTML, an image, an answer over 2 MiB cut at its cap, and a request body over 256 KiB refused | `httpbin.test.ts` |
| OAuth client credentials and password grants against a real token endpoint, the token kept until it expires and then replaced | `keycloak.test.ts` |
| A wrong client secret and a wrong password refused without repeating either, and a token address outside the environment's hosts | `keycloak.test.ts` |

## Not verified

Not tried against a real service:

- **Real exports.** The fixtures are written from documentation, and the tests send them to httpbin, not to the service they describe:
  - Postman: the v2.1 schema and the documentation of the environment export;
  - `.http`: the JetBrains and VS Code documentation;
  - Bruno: Bruno's documentation, its source and the OpenCollection schema;
  - OpenAPI: the specification.

  None was exported from Postman, IntelliJ, VS Code or Bruno, or taken from a service, so a detail those tools add (an old
  export's quirks, a dialect extension, a newer Bruno field) may be read differently. A file the tool cannot read is a problem with
  its file and key, not a crash.
- **How Postman writes WebSocket and gRPC requests** into a collection file. Such a request is refused by its address scheme, its
  method or a protocol profile that names a protocol; a form this does not recognise would be refused later, as an address that is not
  http(s).
- **Bruno details inferred, not read from a rule:**
  - that a folder whose sign-in is `none` leaves the one above in force (Bruno's page says a request "inherits from that folder
    (or a parent folder higher up)" and "if no folder auth is set, from the collection");
  - the order of requests and folders sorted together by `seq`;
  - `hooks` scripts, which are treated as running before the request;
  - `credentials_placement` defaulting to the form when the file says nothing;
  - what `extends` does when a variable is secret in one environment and plain in the other (it stays secret).
- **The Bruno YAML token placement.** The schema calls `tokenConfig.placement.header` a header name, and Bruno's own reader keeps the
  prefix (`Bearer`) there. Both `Bearer` and `Authorization` are accepted; anything else refuses the request.
- **The Postman cloud against the real API.** The fetch was tried against a fake of it. The real answers were read from the
  reference:
  - a collection comes as `{ "collection": ... }` in the v2.1 format;
  - an environment comes as `{ "environment": { "values": [...] } }`;
  - a secret variable of an environment may hold no value, a masked one or a real one.

  A collection in Postman's newer git-native format is not read.
- **The Postman host.** The reference lists `https://api.postman.com` as the default and `https://api.eu.postman.com`; the older
  `api.getpostman.com` is not used.
- **Large spec files and collections:** reading is done on every call, and was only tried on fixtures of a few dozen requests.
- TLS to a real host, including a company certificate authority (the health check of `jig-ops` was tried against a certificate of its own);
- an OAuth server other than Keycloak: whether it takes the client's id and secret as Basic credentials, and the shape of its errors;
- a real sign-in service and transport, which are company code;
- host names that point at a blocked address: names are not looked up (see [Safety](safety.md#addresses-that-are-never-called));
- the review screen: the preview was checked as data, against a fake of `jig-core`, and not seen in the terminal;
- the `/api refresh` screen: the command was run against a fake of Pi's command context, and not typed in the terminal.
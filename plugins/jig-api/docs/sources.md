# Adding a source

A source reads one kind of collection into saved requests. The tool, the variables, the planning and the sending know nothing of a
file format, so a new source is one file in `src/sources/` and a line in `src/sources/index.ts`. Back to the
[jig-api overview](../README.md).

The built ones are:
- Postman files (`postman.ts`);
- `.http` folders (`http-file.ts`);
- Bruno (`bruno.ts`, with a reader for each of its two languages);
- OpenAPI (`openapi.ts`);
- Postman's cloud (`postman-cloud.ts`).

## The interface

```ts
export interface Source<Config = unknown> {
    /** The key that picks this source in a collection's configuration, such as `postman` or `http`. */
    readonly kind: string;

    /** Optional. Two sources may share a key (Postman files and Postman's cloud both use `postman`); this says which one an entry is for. */
    handles?(entry: Readonly<Record<string, unknown>>): boolean;

    /** Checks the object under `api.collections.<name>`. The source owns all of it: its own key and any key that goes with it.
     *  Every mistake is added to `errors`, worded with its key. Returns what `load` needs, or undefined. Must not touch the disk. */
    check(entry: Readonly<Record<string, unknown>>, at: string, errors: string[]): Config | undefined;

    /** Reads the collection. Local files only, and synchronous, because classifying a call needs the request's method before it
     *  runs. Never throws for what is in the files and never runs anything in them: a problem is a `Problem` with its file and
     *  key, and a request that cannot be sent is still listed, with `unsupported` or `scripts` set. */
    load(config: Config, name: string): Collection;

    /** Optional. For a source that keeps a local copy of something fetched: what `/api refresh` runs for the collection. */
    refresher?(config: Config, name: string): Refresher;

    /** Optional. For a source whose service can list its environments by name and id, never their values: what the
     *  `postman_environments` action runs. */
    environmentLister?(config: Config, name: string): EnvironmentLister;
}
```

`check` runs when `jig-core` loads the configuration, `load` on every call that needs the collection. A source that needs the
network (Postman's cloud) fetches to a local copy first, through the sending engine so that a company transport carries it, and
`load` reads that copy.

## What `load` returns

| Field | Meaning |
|---|---|
| `requests` | The `SavedRequest`s (see below) |
| `environments` | By name, each with its `variables` (a secret has no value) and its file |
| `variables` | The collection's own values, the weakest |
| `auth`, `authRefused` | The sign-in of the whole collection, for an ad-hoc `call` that names the collection |
| `productionReads` | Optional. Set by a source that is opt-in per environment (OpenAPI) |
| `root` | The folder every file reference must stay inside |
| `problems` | `{ file, key, message, level }` for everything found wrong, such as a secret that has a plain value |

- **A `SavedRequest`** has its collection, folder path, name, `method`, `url` and `headers` as templates, and a `body` (raw, JSON,
  form, file or GraphQL).
  - It has `auth`: none, bearer, basic, apiKey in a header, or OAuth 2.0 with a headless grant.
  - It has the `variables` it uses, which of them are `secrets` (declared by the environments) or `signsIn`, and its own
    `defaults`.
  - It has `scripts: { prerequest }`, and `unsupported` and `notes`.
  - Optional: `optional` (variables that may stay unset, see below), `variableDocs` and `assertions` (shown by `show`).
- **An environment** may have `unavailable`: a reason that nothing can run in it.
- **`productionReads`:** `false` refuses reads in production, `true` leaves them to the rules. Writes in production are denied by the
  floor either way.

A source does two things itself:
- it marks a variable secret from what its format says, and refuses a plain value for it (a warning, no value kept);
- it sets `unsupported` for a protocol, a method or a sign-in it cannot express, with words that name it.

The rest is done for it: scripts are refused from `scripts.prerequest`, the agent's values are checked against `variables`,
`secrets` and `signsIn`, and every address is checked against the environment's hosts.

## Optional variables

A source that describes parameters (OpenAPI) lists in `optional` the variables that may stay unset. When nobody gives one a value,
`optional.ts` leaves out what hangs on it before any variable is filled:
- a query pair written `name={{variable}}`;
- a header whose whole value is `{{variable}}`;
- a JSON property on a line of its own (and an object that is left with none).

A source that sets `optional` writes its templates in that shape.

## Registering it

Add the adapter to `SOURCES` in `src/sources/index.ts`. The configuration reports its mistakes through `check`; no other file lists
the sources. Tests copy a fixture folder with `copyAcme` in `test/support/acme.ts`, which points its example addresses at the fake servers.

## Facts the sources rely on (read 2026-10-30)

- `.bru` has dictionary, text and array blocks; a `~` before a key switches the line off ([source](https://docs.usebruno.com/bru-lang/language))
- The block names: `meta`, the verbs, `params:query`, `params:path`, `headers`, `body:json`, `body:text`, `body:xml`, `body:form-urlencoded`, `body:multipart-form`, `body:graphql`, `body:graphql:vars`, `vars:pre-request`, `vars:post-response`, `script:pre-request`, `script:post-response`, `tests`, `docs` ([source](https://docs.usebruno.com/bru-lang/tag-reference))
- The `.bru` details that its documentation does not spell out:
  - a block ends at a `}` in the first column;
  - text blocks are indented by two spaces;
  - a value in `'''` is indented by four;
  - the `auth:*` blocks and their fields;
  - `body:file`;
  - `@file(...)` and `@contentType(...)` in a value;
  - `auth { mode }` in `collection.bru` and `folder.bru`;
  - `vars:secret [...]`, `vars:externalsecrets:<manager>` and `extends` in an environment.
  - Source: Bruno's own readers, which its documentation does not spell out: https://github.com/usebruno/bruno/tree/main/packages/bruno-lang/v2/src (`bruToJson.js`, `collectionBruToJson.js`, `envToJson.js`)
- `vars:secret` lists names only, and Bruno keeps the values out of the file ([source](https://docs.usebruno.com/secrets-management/secret-variables))
- `{{process.env.NAME}}` reads a `.env` file of the collection ([source 1](https://docs.usebruno.com/variables/process-env), [source 2](https://docs.usebruno.com/secrets-management/dotenv-file))
- A request set to Inherit takes the nearest folder's sign-in, else the collection's ([source](https://docs.usebruno.com/auth/overview))
- The OAuth 2.0 client-credentials fields: access token URL, client id and secret, scope, credentials placement (body or Basic header), token in a header or the URL ([source](https://docs.usebruno.com/auth/oauth2-2.0/client-credentials))
- Pre-request variables are strings, numbers or JavaScript literals; post-response variables are expressions of `res` ([source](https://docs.usebruno.com/testing/script/vars))
- Assertions are an expression, an operator and a value ([source](https://docs.usebruno.com/testing/tests/assertions))
- OpenCollection YAML: `opencollection.yml`, `folder.yml`, `environments/*.yml`, one request per file ([source](https://docs.usebruno.com/opencollection-yaml/overview))
- A request file is `info`, `http` (`method`, `url`, `headers`, `params` with `type: query` or `path`, `body`, `auth`), `runtime` (`variables`, `scripts` of type `before-request`, `after-response`, `tests`, `assertions`) and `settings`; the body types; the auth types ([source 1](https://docs.usebruno.com/opencollection-yaml/structure-reference), [source 2](https://docs.usebruno.com/opencollection-yaml/samples))
- The OpenCollection schema:
  - auth fields beside `type`;
  - OAuth 2.0 `flow` (`client_credentials`, `resource_owner_password_credentials`, `authorization_code`, `implicit`), `credentials`, `resourceOwner`, `tokenConfig`;
  - an environment's `variables` with `{ secret: true }` for a secret, `externalSecrets`, `extends`, `dotEnvFilePath`;
  - script types including `hooks`;
  - actions with a `phase`;
  - `graphql`, `websocket` and `grpc` requests ([source](https://github.com/opencollection-dev/opencollection/blob/main/packages/oc-schema/src/opencollection.schema.json))
- How Bruno reads the YAML of an environment, a folder and the collection (`name`, `info.seq`, `request`, `extensions.bruno.ignore`) ([source](https://github.com/usebruno/bruno/tree/main/packages/bruno-filestore/src/formats/yml))
- A server's `url` may be relative and hold `{variables}` with defaults ([source](https://spec.openapis.org/oas/v3.1.0#server-object))
- A header parameter named `Accept`, `Content-Type` or `Authorization` is ignored; a path parameter is required; a parameter has a `name`, an `in` (`query`, `header`, `path`, `cookie`), a `schema` or `content` ([source](https://spec.openapis.org/oas/v3.1.0#parameter-object))
- An `operationId` is unique among the operations and case-sensitive ([source](https://spec.openapis.org/oas/v3.1.0#operation-object))
- The request body has `content` by media type, and `required` ([source](https://spec.openapis.org/oas/v3.1.0#request-body-object))
- Security schemes: `apiKey` (`in`: query, header, cookie), `http` (`scheme`), `oauth2` with the flows `implicit`, `password`, `clientCredentials`, `authorizationCode`, `openIdConnect`, `mutualTLS`;
  - a list of requirements needs one of them, the schemes of one requirement all, and `{}` makes security optional;
  - an operation's `security` replaces the spec's ([source 1](https://spec.openapis.org/oas/v3.1.0#security-scheme-object), [source 2](https://spec.openapis.org/oas/v3.1.0#security-requirement-object))
- OpenAPI 3.0 has the same objects, with `nullable` and a single `type` ([source](https://spec.openapis.org/oas/v3.0.3))
- The Postman API takes the key in the `X-API-Key` header of every request; a collection access key is read-only and for one collection ([source](https://learning.postman.com/docs/developer/postman-api/authentication/))
- `GET /collections/{collectionId}` returns `{ "collection": ... }` in the collection format v2.1; `access_key` is a query parameter; the servers are `https://api.postman.com` and `https://api.eu.postman.com`; an unknown collection is a 400 ([source](https://learning.postman.com/api-docs/api-reference/collections/get-collection))
- `GET /environments/{environmentId}` returns `{ "environment": { "values": [{ "key", "value", "type": "secret" or "default", "secret", "source", "enabled" }] } }` ([source](https://learning.postman.com/api-docs/api-reference/environments/get-environment))
- The Postman API allows 300 requests a minute for a key ([source](https://learning.postman.com/docs/developer/postman-api/postman-api-rate-limits))
- A collection access key expires after 60 days without use ([source](https://learning.postman.com/api-docs/api-reference/collection-access-keys/get-collection-access-keys))
- `yaml` (ISC, no dependencies) parses YAML 1.2 without running anything, limits aliases and reports an error's code and position ([source](https://github.com/eemeli/yaml))

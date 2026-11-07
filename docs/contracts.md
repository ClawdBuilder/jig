# Front-end contracts

Jig's engine and its optional front-ends meet here. Every surface below has a version, and a front-end may read only these;
it never imports Jig's `src/` and never approves a call.

| Surface | Version | Shape | Breaking change |
|---|---|---|---|
| Session status | `schema: 1` | The status file `jig-session` writes in the agent folder | Removing or changing a field; a new required field |
| Session requests | `REQUEST_SCHEMA = 1` | `contracts/requests.ts`: `parseRequest`, `takeRequest`, request and outcome fields | A field rename or a new required field |
| Review API | `/api/review` show/comment routes | Read the review and post comments; approval routes are not for front-ends | A route change or an approval route exposed to a panel |
| Stage event | `jig:stage-done` | `ticket`, `workflow`, `from`, `to`, `at`, `last`, `via` | Removing a field or changing its meaning |
| Palettes | `contracts/palettes.json` | The built-in Pi palette files, by file name | Renaming or changing a colour key |

A new optional field is compatible. A front-end declares the versions it supports, and tests against the published
`@clawdbuilder/jig`, never a relative path into Jig. The browser review page is built in; `jig-herdr` is optional and
lives in its own repository. Only the passkey page, `y` in Pi or an `/approve` command approves.

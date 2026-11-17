# jig-jira src

## Overview

One Pi tool, `jira`, over Jira's REST API version 2 (wiki markup; Cloud and Data Center). Reads format a bounded answer. Every write is planned, shown as a preview, fingerprinted, and sent at most once. All requests go through `jig-core`'s HTTP request path, which attaches the credential, so this code holds none.

Specification: [README](../README.md); detail: [Parameters](../docs/parameters.md), [Writes](../docs/writes.md), [Commented by](../docs/commented.md), [Configuration](../docs/configuration.md).

## Interface

- **Entry**: `index.ts` exports `jigJira(options?: JiraOptions)` and `default jigJira()`. It registers the `jira` section (`{ replace: ["auth"], union: ["privateNames"], methods: JIRA_METHODS, setup: JIRA_SETUP }`), declares the tool `{ tool: "jira", plugin: "jig-jira", classify, preview }` and registers the tool with Pi. Nothing is read or sent at load.
- **Tool** (`tool.ts`: `createTool`, `JiraTool`; `executionMode: "sequential"`): 9 reads `get`, `search`, `comments`, `transitions`, `changelog`, `attachments`, `assignable`, `find_field`, `link_types`; 8 writes `create`, `comment`, `edit_comment`, `delete_comment`, `transition`, `update`, `link`, `unlink`.
- **Input and class**: `params.ts` (`ACTIONS` table of kind, required and optional fields, `parameters`, `parseCall`, `usage`, `isAction`), `classify.ts` (`classifyCall`).
  **`onboarding.ts`**: `JIRA_SETUP`, the section's setup questions.
- **Config section `jira`** (`config.ts`: `validateJira`, `readJira`, `settingsOf`, `JiraSettings`, `Auth`, `DEFAULT_UPDATE_FIELDS`, `DEFAULT_ENVIRONMENT`, `COMMENT_SEARCH_MODES`): `site`, `auth`, `projects`, `updateFields`, `fields`, `createDefaults`, `privateNames`, `environment`, `me`, `commentSearch`.
- **Requests**: `http.ts` (`createHttp`, `JiraError`, `NotSentError`, `LostReplyError`, `TIMEOUTS`), `api.ts` (REST wrappers, `Session`, `Env`), `create-meta.ts`.
- **Reads**: `reads.ts` (`runRead`), `commented.ts` (`commentedSearch`, `MAX_CANDIDATES`), `jql.ts`, `window.ts`, `format.ts` (output formatters and caps).
- **Writes**: `plan.ts` (`Plan`, `fingerprintOf`), `plans.ts` (`buildPlan`), `plan-comment.ts`, `plan-create.ts`, `plan-issue.ts`, `plan-link.ts`, `plan-fields.ts`, `writes.ts` (`runWrite`).
- **Preview**: `shown.ts` (`Shown`, `previewOf`), `page.ts` (`htmlOf`, the review page), `wiki.ts` (`renderWiki`), `pointers.ts` (`pointersIn`, `flagLines`).
- **Values**: `fields.ts` (field names, ids, `MAX_TEXT`), `field-hint.ts` (did-you-mean), `values.ts` (`InputError`, `userOf`).

## Invariants

- **Imports from `jig-core`** are only `client.ts`, `contract.ts` and `kit/` (`http`, `schema`, `text`, `tools`, `values`).
- **Credentials.** Secret fields are secret references (`/^[a-z][a-z0-9+.-]*:\S+$/`); a pasted token is refused without repeating it. The plugin passes references to `jig-core` as `HttpAuth` and never reads a value. No sign-in flow. Auth is exactly one of `email`+`token`, `token`, `signIn`, `transport`, or `oauth` (with an optional `cloudId`, which sends requests to the Atlassian API address).
- **https only.** `site` has no userinfo, query or fragment, and the URL is rebuilt and re-checked for each request. Redirects are not followed. Errors carry no credential and no site address: they name the method and request path, Jira's own error text (cut to 400 characters) and, for a 3xx answer, only the host of the `Location` header (`http.ts` `describeFailure`).
- **Preview equals execute.** Both parse the call the same way and build the same plan. The fingerprint is `sha256` over the canonical `{ send, basis }`, cut to 32 hex characters. If it differs from the approved preview's, the write is refused as changed since the preview, and nothing is sent.
- **Never sent twice.** `NotSentError` says nothing was sent. A refused answer (status 300 to 499 except 408) says Jira changed nothing. Any other failure or a lost reply triggers one re-read through `plan.check()` and reports whether the write happened; no resend, and no re-read after an abort.
- **Only `InputError` blocks a call without asking.** A bare `TypeError` from a bug is rewrapped as `internal error:`. Preview reads return a one-line summary; only writes call `buildPlan`. An unset or invalid `jira` section throws `InputError`.
- **`classifyCall` is pure.** An unknown action returns `undefined` (the call asks). Reads are `read`. `create`, `comment`, `edit_comment` and an `update` that sets the description use the review screen; the other writes use a dialog. The environment is `settings.environment`, default `external`.
- **Write limits.** `update` sets only `updateFields` (default `summary`, `description`, `labels`, `priority`, `assignee`); `createDefaults` cannot set the project, issue type or summary; the project must match `/^[A-Z][A-Z0-9_]{0,19}$/` and be in `projects` when that list is set;
  `link` and `unlink` also refuse an end outside `projects` when it is set; `edit_comment` and `delete_comment` change only your own comment
  unless `othersComments` is true, and refuse when neither `GET /myself` nor `jira.me` says who you are; text is non-empty, has no NUL and is at most 32,767 characters.
- **The local-pointer check only flags.** Home paths, `file://`, `./script.sh` and `privateNames` are marked in the preview and never block.
- **The page and the text come from the same `Shown` data**, so they cannot disagree. The page only shows; approval stays in Pi.
- **Read bounds.** Answers over 8 MiB are not read and count as a lost reply; a 2xx that is not JSON is a lost reply; timeouts `timeoutSeconds` (default 30 s) and `searchTimeoutSeconds` (default 60 s), each 5 to 120. Output caps: description 4,000, comment 1,500, latest comments 5, `commented` shows 100 matches, 10 hits, 5 unread. `search commented` reads at most 500 candidates (more is refused with advice), 4 comment reads at once; matches list ids and dates, not text.
- **README and docs are the specification.** `test/classify.test.ts` reads the README and `docs/parameters.md` tables; every action is in `plugins/jig-core/test/audit.test.ts`. Change the README table, the code and the tests together.

## Side Effects

- **Network**: only through `jig().http.request` with system `jira`, `User-Agent: jig-jira`, to `<site>/rest/api/2` (or `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/2` for OAuth with a `cloudId`). Endpoints: issues, comments, transitions, `/field`, `/myself`, `/issueLink` and `/issueLinkType`, `/user/assignable/search`, `/search/jql` (Cloud) or `/search` (Data Center), create metadata and `/project`.
- **`jig-core` calls**: `config.section("jira")`, `approvedPreview(toolCallId)`, `addFacts(toolCallId, { issue })` after a write (and `candidates`, `matched`, `method`, `unread` after a `commented` search). An OAuth token is cached and refetched once after a 401 by `jig-core`, not here.
- **In memory only**, per Pi session: the search dialect, the field list (read once) and whether ScriptRunner is present.
- **None**: no disk writes, no environment variables, no timers, no slash commands and no Pi event hooks.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-jira/test/*.test.ts"`
- The tests use a fake Jira server and a fake `jig-core` (`test/support/`).
- Docs the tests read: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.

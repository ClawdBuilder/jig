# jig-jira: Jira issues

**Status: built.** Tested against a fake Jira on this machine and used in real sessions against a real Jira through a
company transport: reads, a create, updates and a link. Not tried: the direct auth forms, Jira Cloud, ScriptRunner,
attachments and transitions (see [Not verified yet](docs/not-verified.md)).

`jig-jira` gives the agent one tool, `jira`, over Jira's REST API version 2,
which takes wiki markup and works on Jira Cloud and on Jira Data Center. Every
write shows a rendered preview before it is sent, and `jig-core` governs every
call.

For example, `jira comment` on `PROJ-123` shows the comment as Jira will render
it, and posts it only after you press `y`.

![The same generic jira tool set up by two companies, each with its own site, sign-in, ticket key pattern and overlay skill](../../docs/img/company-plugs-in.svg)

*The same `jira` tool for two companies. The difference is configuration and knowledge, not code: each company plugin supplies its own site, sign-in, ticket key pattern and an overlay skill, which is its own rules added to this plugin's skill.*

## Tool: `jira`

`action` picks the operation. Calls run one at a time, in order.

| Action | Kind | What it does |
|---|---|---|
| `get` | read | An issue's fields, description and latest 5 comments |
| `search` | read | Issues matching a JQL query, with paging; with `commented`, the issues a person commented on |
| `comments` | read | The newest comments, up to 100 |
| `transitions` | read | The transitions available, with their target status |
| `changelog` | read | Status and field history |
| `attachments` | read | The list of attachments; files are not downloaded |
| `assignable` | read | Users who can take the issue |
| `find_field` | read | Field ids and names matching a text |
| `link_types` | read | The link types, with what each end reads, such as `blocks` and `is blocked by` |
| `create` | external write, asks on the review screen | Creates an issue; the preview shows every field and possible duplicates |
| `comment` | external write, asks on the review screen | Adds a comment |
| `edit_comment` | external write, asks on the review screen | Replaces a comment's text |
| `delete_comment` | external write, asks on a dialog | Deletes a comment. This cannot be undone |
| `transition` | external write, asks on a dialog | Moves the issue; the name must match exactly one transition |
| `update` | external write, asks on a dialog; review screen when it sets the description | Sets allowed fields such as summary, labels, priority or assignee |
| `link` | external write, asks on a dialog | Links two issues with a link type; the preview names both and the type |
| `unlink` | external write, asks on a dialog | Removes the link between two issues; the preview names both and the type |

Writes go to `external` (or the environment you set), so they ask you by
default. Each action's parameters, and the limits on what the tool returns, are
in [Parameters](docs/parameters.md).

## Finding issues by who commented

JQL has no "commented by" (only an app, ScriptRunner, adds one), so `search` takes a `commented` filter. `from` and `to` are whole
days on your own clock, midnight to midnight, and both days are included.

```json
{ "action": "search", "jql": "project = PROJ", "commented": { "by": "me", "from": "2026-10-01", "to": "2026-10-31" } }
```

- **Candidates:** the issues of your JQL (or of `projects`) updated since `from`, at most 500. More is refused, with advice on narrowing.
- **Exact check:** every comment of each candidate is read, and an issue matches when one is by that person and was created in
  the days. A match is listed with the ids and dates of those comments, not their text.
- **Two methods:** `read` reads the comments. `scriptrunner` lets ScriptRunner's `commented()` shorten the list of candidates where
  the site has it; `commentSearch` chooses. `me` names you where the site has no `/myself`.
- **JQL note:** a `search` whose JQL says `labels != x` is told that it also drops issues with no labels (see Rules).

The rules, limits and failures are in [Commented by](docs/commented.md).

## Rules

- **Rendered previews.** Text is Jira wiki markup, and the review screen shows
  it before it is sent. `o` opens the rendered page; the browser only shows,
  and approval stays in Pi.
- **Local-pointer check.** Outgoing text is checked for local paths and for the
  names in `privateNames`. They are flagged in the preview and do not block: you
  decide.
- **Invalid input is not asked about.** Every call is checked before anyone is
  asked, and a mistake blocks the call with a message that says what to change.
- **Your own comments only.** `edit_comment` and `delete_comment` refuse a comment
  by someone else, or when Jira cannot say who you are and `me` is not set.
  `othersComments` allows other people's.
- **Writes are previewed and never resent.** [Approvals](../../docs/approvals.md#preview-digest-and-a-lost-reply)
  has the digest and lost-reply rule; Jira reads the issue once.
- **JQL notes.** A `search` whose JQL says `labels != x` (or `not in`, or the same
  with `component` or `fixVersion`) gets a note: such a clause also drops issues
  that have none. It is a note, never a refusal.
- **Facts.** After a write, the call's record carries the issue key, as the
  fact `issue`. After a `search` with `commented`, it carries `candidates`,
  `matched`, `method` and `unread`.

## Configure

In `~/.pi/agent/jig.json`, under `jira`. An unknown field is an error, and the
tool then does nothing until the file is fixed (`/jig` lists the problems).

| Field | Default | Meaning |
|---|---|---|
| `site` | required | The https address of the Jira, such as `https://example.atlassian.net` |
| `auth` | required | How requests are signed in: exactly one of the five forms below |
| `projects` | none | Project keys, such as `["PROJ"]`, for `search` without JQL; `create` and links take only these |
| `updateFields` | `summary`, `description`, `labels`, `priority`, `assignee` | The fields `update` may set, by name or id |
| `fields` | none | Friendly names for field ids, such as `"Story Points": "customfield_10016"` |
| `createDefaults` | none | Values `create` gives a field when the call does not set it, by field name or id |
| `privateNames` | none | Folder or host names to flag in outgoing text, up to 100 |
| `environment` | `external` | The environment name that rules and classification know this Jira by |
| `me` | none | Your account id (Cloud) or user name (Data Center), for when `/myself` is unavailable |
| `othersComments` | `false` | `true` lets `edit_comment` and `delete_comment` change other people's comments |
| `commentSearch` | `auto` | How `commented` finds issues: `auto`, `scriptrunner` or `read` (see [Commented by](docs/commented.md)) |

A screen field whose schema says `array` takes one value as a one-item list; the preview says when it wrapped one.

The fields in detail are in [Configuration](docs/configuration.md).

| `auth` | Signs in with | For |
|---|---|---|
| `{ "email": "...", "token": "<secret reference>" }` | Basic authentication with an API token | Jira Cloud |
| `{ "token": "<secret reference>" }` | A personal access token, sent as a Bearer token | Jira Data Center |
| `{ "signIn": "<service name>" }` | The headers of a company sign-in service, asked for on every request | A company's single sign-on |
| `{ "transport": "<name>" }` | A company transport: every request goes through it, and the tool holds no token | A company that reaches Jira only through a local sign-in proxy |
| `{ "oauth": "cmd:<name>", "cloudId": "<id>" }` | An OAuth access token printed by a declared command, sent as Bearer; `cloudId` selects the Cloud API address | Cloud 3LO ([guide](docs/oauth-cloud.md)) |
| `{ "oauth": "cmd:<name>" }` | The same Bearer token, sent to the site URL | Data Center OAuth ([guide](docs/oauth-data-center.md)) |

The `oauth` value is a secret reference to a command, and the command is declared in `secrets.commands`. The other tokens
are secret references such as `pass:work/jira-token` (see
[Secrets](../../docs/secrets.md)); a token written into the file is refused, and
the error does not repeat it.

A token or a header is never put in a result or an error, and `jig-core` removes
it from output as well. With a transport, `site` still builds the URL of every
request, and the answer's status, headers and body are read as an HTTP answer
is.

```json
{
  "jira": {
    "site": "https://example.atlassian.net",
    "auth": { "email": "jane@example.test", "token": "pass:work/jira-token" },
    "projects": ["PROJ"],
    "fields": { "Story Points": "customfield_10016" },
    "updateFields": ["summary", "description", "labels", "priority", "assignee", "Story Points"],
    "privateNames": ["payroll", "corp.example.net"]
  }
}
```

## Company part (in the company plugin)

- the Jira site;
- the sign-in: a company sign-in service, a company transport, or an API token
  through a secret reference;
- the project keys, so that `search` needs no JQL for them and `create`, `link`
  and `unlink` cannot reach another project;
- default fields: friendly names, the fields `update` may set, and private names — its `privateNames` and yours add up;
- the environment name, when it is not `external`.

## Layout

```text
jig-jira/
  index.ts  the entry Pi loads: it hands on src/index.ts, so Pi shows the plugin's name
  src/      the tool and its checks (index, tool, params, classify, config), Jira's endpoints and request (api, http,
            create-meta), field names and values, what the model reads (format, reads), the search by who commented
            (commented, jql, window), writes and their previews (plan*, shown, page, writes), the wiki-markup renderer
            (wiki), the local-pointer check (pointers)
  skills/   jira/SKILL.md: comment style and conventions
  test/     against a fake Jira server on this machine and a fake jig-core
  docs/     the detail pages below
```

## More detail

- [Parameters](docs/parameters.md): what each action needs, fields, limits on results, and people
- [Commented by](docs/commented.md): the `commented` filter of `search`, its days, candidates, checks and ScriptRunner
- [Configuration](docs/configuration.md): the fields of the `jira` section in detail
- [Writes](docs/writes.md): the rules for writes in full, and what each preview shows
- [Not verified yet](docs/not-verified.md): what needs a real Jira
- [Wiki markup](docs/wiki-markup.md): the Jira syntax and its traps

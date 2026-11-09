# Configuration: the `jira` section

The fields of the `jira` section of `jig.json`, in detail. Back to the overview.

- **`site`** may have a path, but no user name, password, query or fragment.
  Plain `http` is refused.
- **`auth`** is exactly one of the five forms in the overview. A token or an
  `oauth` command is a secret reference, never the token itself. `cloudId` is
  only for OAuth on Jira Cloud; without it the token goes to the site address.
- **`projects`:** up to 50 project keys, such as `["PROJ", "OPS"]`, written in any
  case and kept in upper case. A key is a letter, then letters, digits and `_`, up
  to 20 characters. Yours replaces a company's list whole.
  - **`search` without `jql`** looks in these projects, newest first: `project in
    ("PROJ", "OPS") ORDER BY updated DESC`. The result names the query it ran.
    With `jql` the query is sent as written, and with no `projects` a search
    still needs `jql`.
  - **`create` accepts only these projects.** Another project is refused before
    anyone is asked or Jira is called, and the message lists the ones allowed.
    With no `projects`, `create` takes any project.
  - **`link` and `unlink` accept only links with both issues in these projects.**
    The keys are the ones Jira answers with, so an issue that moved is judged
    where it is now. A link with an end outside is refused before anyone is
    asked, naming the issue, its project and `jira.projects`. With no
    `projects`, any two issues may be linked.
- **`updateFields`:** up to 100 fields, by name or id. `create` may set any
  field on the create screen. A field not listed here is refused by `update`;
  find its id with `jira find_field`, then add it here.
- **`fields`:** a name is 1 to 60 characters and cannot be one the tool already
  knows. Friendly names work in `fields`, `include` and `updateFields`.
- **`createDefaults`:** up to 30 fields, each a name and the value to give it, such
  as `{ "Priority": "Medium", "Components": ["Web"], "Story Points": 1 }`. It is
  applied to `create` for each field the call does not set.
  - **Names** are resolved as a field in a `create` call's `fields` is: a name the
    tool knows, a friendly name from `fields`, or a field's name or id on the create
    screen. Case does not matter.
  - **Values** are checked as the call's own are, against what the create screen
    allows. A value the screen refuses stops the `create` and says it comes from
    `createDefaults`; setting the field in the call is the way out.
  - **A field the call sets** (an empty value included) is never defaulted. A
    default for a field that is not on the issue type's screen is left out, and the
    preview says so.
  - **In the preview** a default shows as `Priority: Medium (from your defaults)`.
    It goes into the request, so changing it while you read voids the approval.
  - **Not allowed:** `project`, `issuetype` and `summary`, which the call sets.
- **`privateNames`:** up to 100 folder or host names that are flagged in
  outgoing text (see [Writes](writes.md)).
- **`environment`:** letters, digits, `_` and `-`, starting with a letter, up to
  40 characters.
- **`me`:** up to 128 characters, no line breaks. It is read only when
  `GET /myself` is unavailable: some sites reach Jira through a sign-in proxy
  that has no "who am I". Use the account id on Jira Cloud, and the user name
  (or the key) on Data Center. Two things read it:
  - **the `commented` filter of `search`,** for `"by": "me"` (see
    [Commented by](commented.md));
  - **`edit_comment` and `delete_comment`,** to tell your comments from other
    people's (see `othersComments`).
- **`othersComments`:** `true` or `false` (the default). With `false`,
  `edit_comment` and `delete_comment` change only your own comments.
  - **Who you are** is what `GET /myself` says, or else `me`. On Cloud the
    comment's author is matched by account id, on Data Center by user name, key
    or email address.
  - **Someone else's comment** is refused before anyone is asked, with the
    author's name and this setting.
  - **When neither says who you are,** the change is refused too, naming
    `jira.me`.
  - **With `true`,** any comment the account may change is changed, and
    `GET /myself` is not asked.
- **`commentSearch`:** `auto` (the default), `scriptrunner` or `read`. It says
  how the `commented` filter finds issues; the three modes are in
  [Commented by](commented.md).


## The fields

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
| `commentSearch` | `auto` | How `commented` finds issues: `auto`, `scriptrunner` or `read` (see [Commented by](commented.md)) |

## Auth forms

| `auth` | Signs in with | For |
|---|---|---|
| `{ "email": "...", "token": "<secret reference>" }` | Basic authentication with an API token | Jira Cloud |
| `{ "token": "<secret reference>" }` | A personal access token, sent as a Bearer token | Jira Data Center |
| `{ "signIn": "<service name>" }` | The headers of a company sign-in service, asked for on every request | A company's single sign-on |
| `{ "transport": "<name>" }` | A company transport: every request goes through it, and the tool holds no token | A company that reaches Jira only through a local sign-in proxy |
| `{ "oauth": "cmd:<name>", "cloudId": "<id>" }` | An OAuth access token printed by a declared command, sent as Bearer; `cloudId` selects the Cloud API address | Cloud 3LO ([guide](oauth.md)) |
| `{ "oauth": "cmd:<name>" }` | The same Bearer token, sent to the site URL | Data Center OAuth ([guide](oauth.md)) |

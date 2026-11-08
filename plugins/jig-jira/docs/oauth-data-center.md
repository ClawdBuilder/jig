# OAuth on Jira Data Center

Jig never opens a browser, runs a sign-in flow or stores a refresh token. A command you already trust owns the OAuth
session, prints a short-lived access token, and exits. Jig reads it through [Secrets](../../../docs/secrets.md), sends it
as `Authorization: Bearer`, keeps it in memory for five minutes, and runs the command once more after a 401. Without
`auth.cloudId`, requests go to the site URL, as Data Center expects.

## 1. The incoming application link

On your Jira Data Center, add an **incoming application link** with OAuth 2.0 (3LO) and PKCE. The exact screen and the
version that supports it are in Atlassian's Jira OAuth 2.0 provider API documentation for your release. Register the
helper's localhost callback, not Jig's, and request the Jira REST scopes your version offers; the helper needs:

- the equivalent of `read:jira-work` for issues, fields, comments and links;
- the equivalent of `write:jira-work` for create, update and comment;
- the equivalent of `read:jira-user` for `me` and `commented`;
- offline access only if the helper keeps a refresh token.

Some Data Center versions label these scopes `READ`, `WRITE` and user-read; use the names that release's application link
prints. Keep the client id and secret in the helper's own configuration.

## 2. The command

The helper does the browser/PKCE sign-in the first time, stores the refresh token where only you can read it, renews it,
and prints **only** the access token on standard output. A shape:

```bash
#!/usr/bin/env bash
# jira-dc-token: your own OAuth helper; it owns the refresh token and prints an access token.
exec /home/you/.local/bin/jira-dc-oauth-helper access-token
```

Declare it by name in `jig.json`; a command not declared here cannot run:

```json
{
  "secrets": {
    "backends": ["cmd"],
    "commands": { "jira-oauth": ["/home/you/.local/bin/jira-dc-token"] }
  },
  "jira": {
    "site": "https://jira.example.test",
    "auth": { "oauth": "cmd:jira-oauth" }
  }
}
```

The command sees only the short environment list Jig gives a secret command, not your whole environment. Its standard
output is trimmed; more than 16 KiB, an empty answer or a non-zero exit is refused. The token is registered with Jig's
redactor and is never written to a record, a log, an error or the review page.

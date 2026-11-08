# OAuth on Jira Cloud

Jig never opens a browser, runs a sign-in flow or stores a refresh token. A command you already trust owns the OAuth
session, prints a short-lived access token on standard output, and exits. Jig reads that command through
[Secrets](../../../docs/secrets.md), sends the token as `Authorization: Bearer`, keeps it in memory for five minutes,
and runs the command once more if Jira answers 401. The command is run again on the next call after that cache expires.

## 1. The app in the Atlassian developer console

Make an OAuth 2.0 (3LO) app in the [Atlassian developer console](https://developer.atlassian.com/console/myapps/) for
your own Cloud site. Its callback URL is the helper's own localhost callback, not Jig's. Add the Jira API scopes:

- `read:jira-work` for issues, fields, comments and links;
- `write:jira-work` for create, update and comment;
- `read:jira-user` for the account names `me` and `commented` use;
- `offline_access` if the helper keeps a refresh token, so it can print a new access token after this one expires.

Copy the client id and secret into the helper's own configuration, never into `jig.json`.

## 2. The Cloud id

A 3LO token is for an app and a site together. Ask the site for its cloud id, for example with
`GET https://<your-site>/_edge/tenant_info`, or read it from the accessible-resources response the helper already gets.
Put it in `auth.cloudId`. Jig then calls
`https://api.atlassian.com/ex/jira/<cloudId>/rest/api/2/...`; without `cloudId` it uses the site address, which is the
Data Center form.

## 3. The command

The helper is a program you install and trust. It may do the browser sign-in the first time, keep the refresh token in
your operating system's keyring, renew it, and print **only** the access token on standard output. A shape:

```bash
#!/usr/bin/env bash
# jira-token: your own OAuth helper; it owns the refresh token and prints an access token.
exec /home/you/.local/bin/jira-oauth-helper access-token
```

Declare it by name in `jig.json`; the name is what `jig-jira` asks for, and a command not declared here cannot run:

```json
{
  "secrets": {
    "backends": ["cmd"],
    "commands": { "jira-oauth": ["/home/you/.local/bin/jira-token"] }
  },
  "jira": {
    "site": "https://example.atlassian.net",
    "auth": { "oauth": "cmd:jira-oauth", "cloudId": "00000000-0000-0000-0000-000000000000" }
  }
}
```

The command sees only the short environment list Jig gives a secret command, not your whole environment. Its standard
output is trimmed; more than 16 KiB, an empty answer or a non-zero exit is refused. The token is registered with Jig's
redactor and is never written to a record, a log, an error or the review page.

# Jira OAuth

Two guides: Cloud 3LO and Data Center OAuth. Back to the [jig-jira overview](../README.md).

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

Copy the client id and secret into the helper's own configuration, never into `jig.json`. Atlassian rotates refresh
tokens: the helper must save the new one on every refresh, or the next call loses the session.

## 2. The Cloud id

A 3LO token is for an app and a site together. Ask the site for its cloud id, for example with
`GET https://<your-site>/_edge/tenant_info`, or read it from the accessible-resources response the helper already gets.
Put it in `auth.cloudId`. Jig then calls
`https://api.atlassian.com/ex/jira/<cloudId>/rest/api/2/...`; without `cloudId` it uses the site address, which is the
Data Center form. A wrong `cloudId` makes every call look expired: Jig runs the command again once per call, which is
the cost of the mistake — fix the id rather than the helper.

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
    "backends": ["pass", "cmd"],
    "commands": { "jira-oauth": ["/home/you/.local/bin/jira-token"] }
  },
  "jira": {
    "site": "https://example.atlassian.net",
    "auth": { "oauth": "cmd:jira-oauth", "cloudId": "00000000-0000-0000-0000-000000000000" }
  }
}
```

`secrets.backends` replaces the default, which is `pass` alone; keep `pass` in the list if you still use it. The command
sees only the short environment list Jig gives a secret command, not your whole environment. Its standard
output is trimmed; more than 16 KiB, an empty answer or a non-zero exit is refused. The token is registered with Jig's
redactor and is never written to a record, a log, an error or the review page.

# OAuth on Jira Data Center

Jig never opens a browser, runs a sign-in flow or stores a refresh token. A command you already trust owns the OAuth
session, prints a short-lived access token, and exits. Jig reads it through [Secrets](../../../docs/secrets.md), sends it
as `Authorization: Bearer`, keeps it in memory for five minutes, and runs the command once more after a 401. Without
`auth.cloudId`, requests go to the site URL, as Data Center expects.

## 1. The incoming application link

On your Jira Data Center, add an **incoming application link** with OAuth 2.0 (3LO) and PKCE. The exact screen and the
version that supports it are in Atlassian's Jira OAuth 2.0 provider API documentation for your release. Register the
helper's localhost callback, not Jig's, and request the Jira REST scopes your version offers; the helper needs:

- `READ` for issues, fields, comments and links;
- `WRITE` for create, update and comment. `WRITE` covers everything `jig-jira` writes;
- `ADMIN` or `SYSTEM_ADMIN` only if your helper's own administration needs them; the Jira tool does not.

There is no user-read scope in an incoming Jira Data Center application link. Keep the client id and secret in the helper's
own configuration.

OAuth 2.0 incoming application links arrived in Jira Data Center **8.22**; the 8.22 provider API supports the authorization
code flow with PKCE. See the [8.22 provider API](https://confluence.atlassian.com/adminjiraserver0822/jira-oauth-2-0-provider-api-1142237088.html),
the [8.22 release notes](https://confluence.atlassian.com/jirasoftware/jira-software-8-22-x-release-notes-1115656979.html)
and the [incoming-link scopes](https://confluence.atlassian.com/adminjiraserver/oauth-2-0-scopes-for-incoming-links-1115659069.html)
for your version.

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
    "backends": ["pass", "cmd"],
    "commands": { "jira-oauth": ["/home/you/.local/bin/jira-dc-token"] }
  },
  "jira": {
    "site": "https://jira.example.test",
    "auth": { "oauth": "cmd:jira-oauth" }
  }
}
```

`secrets.backends` replaces the default, which is `pass` alone; keep `pass` in the list if you still use it. The command
sees only the short environment list Jig gives a secret command, not your whole environment. Its standard
output is trimmed; more than 16 KiB, an empty answer or a non-zero exit is refused. The token is registered with Jig's
redactor and is never written to a record, a log, an error or the review page.


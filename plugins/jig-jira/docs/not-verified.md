# Not verified yet

What the tests of `jig-jira` do not cover. Back to the
[jig-jira overview](../README.md).

Written from Jira's documentation, a fake Jira on this machine, and real sessions that reached a real Jira through a
company transport (reads, a create, updates and a link). Still not tried:
- the direct sign-in forms (`basic`, `bearer`, `oauth`, `signIn` and `transport`) against a real gateway; the real sessions used
  one company transport, not these;
- Jira Cloud: `search/jql` and the Cloud create screen, users and long comment threads; the real sessions used one site;
- attachments and transitions on a real site;
- how the rendered page compares with Jira's own rendering of unusual markup;
- that a real sign-in proxy answers `GET /myself` with 403 or 404, or refuses it
  from its transport, as `comment` expects (the fake Jira and a fake transport do);
- **which issue is `outwardIssue` in `POST /issueLink`.** The tool sends the issue
  that reads the outward phrase ("blocks") as `outwardIssue`, as Jira's description
  of the "from" issue says, and reads the result back the way `get` shows links.
  The fake Jira follows the same reading, so the tests cannot show it is right.
  Try `link` once on a real Jira and read both issues: if the link reads the wrong
  way round, swap the two keys in `src/plan-link.ts`;
- link types on an old Jira, and `DELETE /issueLink/{id}` on both editions;
- a transition whose screen asks for a field (`resolution`, for example): the
  tool sends no field with a transition, and Jira's refusal is shown.

## The `commented` filter

What the filter of `search` (see [Commented by](commented.md)) needs a real Jira for. The fake Jira plays what the
documentation says, so the tests cannot show any of this. Try it once on a real Data Center and a real Cloud site.
- **ScriptRunner's real answer.** That `issueFunction in commented("by U after D before D")` is accepted as written, with an
  account id on Cloud as well as a user name on Data Center, and whether ScriptRunner offers `commented` on Cloud at all.
- **What a site without ScriptRunner says.** The tool takes a 400 that names `issueFunction` (or the function `commented`) to
  mean "not installed", and remembers it for the session. A real site may word that differently, and `auto` then reads the
  comments for that call and tries again on the next.
- **Whether `after` and `before` take their own day in.** ScriptRunner's documentation does not say, and it reads a time in the
  server's zone. The tool widens each day by two and checks every comment itself, so the answer should not change.
- **How much of a thread Jira embeds with a search,** on each edition. The tool compares the comments it got with the `total`
  and reads the rest, but the real limits are not confirmed, nor whether Cloud's `/search/jql` sends `total` at all.
- **How many comments one page of `/issue/{key}/comment` holds,** and whether either edition caps `maxResults` below 100.
- **How `updated >= "2026-10-01"` is read** by an account whose time zone is far from the one the tool runs in. The tool starts
  a day early, which covers a difference of up to 24 hours.
- **`GET /myself` behind a real sign-in proxy,** and the account id or user name that `jira.me` should hold on each edition.
- **Comments an account cannot see** (restricted by role or group). A real Jira leaves them out of the thread, so a person who
  wrote only such comments is not found by an account that cannot read them.

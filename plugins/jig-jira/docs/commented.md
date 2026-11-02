# Commented by

How `search` finds the issues a person commented on, in the days you name, and what it can and cannot promise. Jira's JQL has no
"commented by" of its own, so the tool lists candidate issues and reads their comments. Back to the
[jig-jira overview](../README.md).

## The call

```json
{
  "action": "search",
  "jql": "project = PROJ AND status != Closed",
  "commented": { "by": "me", "from": "2026-10-01", "to": "2026-10-31" }
}
```

| Part | Meaning |
|---|---|
| `by` | `me`, or an account id, user name, key or email address (never a display name) |
| `from` | The first day, `YYYY-MM-DD`. Left out: no first day |
| `to` | The last day, `YYYY-MM-DD`, included. Left out: no last day |
| `jql` | Where to look. Left out: the projects of `jira.projects`, as for any `search` |
| `include` | Extra fields to show under each match, as for any `search` |

`limit` and `page` are refused with `commented`: the result lists every match (the first 100, then a count of the rest).

## Days

- **A day is a day on your clock,** from midnight to midnight where the tool runs, as in [jig-lens](../../jig-lens/README.md). It is
  not a UTC day and not a day in Jira's time zone.
- **Both days are included.** `from` and `to` on the same day name that one day.
- **A comment is placed by its own time.** Jira writes `2026-10-12T14:03:22.123+0000`; the offset is read, so a comment written as
  30 September in UTC can be 1 October for you.
- **An end left out is open.** With neither, every comment by the person counts.

## Candidates

The candidates are the issues the JQL finds, narrowed by the first day.

- **The caller's JQL is wrapped in parentheses** and ANDed with `updated >= "<day before from>"`, so an `OR` in it cannot swallow the
  condition. A trailing `ORDER BY` stays last. The query that ran is named in the result.
- **The condition is a day early.** Jira reads that date in the time zone of the account that searches, which may not be yours. An
  issue is left out only when it was not touched at all since the day before.
- **There is no upper bound on `updated`.** A later edit moves `updated` past the window, and the issue is a match all the same when
  the comment was made inside it.
- **At most 500 candidates.** More is refused before any comment is read, with a message that says to narrow the JQL (a project, a
  component, a status, an assignee) or to give a later `from`. Data Center says how many there are with the first page; Jira Cloud
  does not count, so the tool stops at the 501st.

## The exact check

- **Every comment of each candidate is read.** The search asks for the `comment` field, and when Jira sends a whole thread with the
  issue, that is used. When it sends part of one (fewer comments than its `total`), or none, the tool pages
  `/issue/{key}/comment` from the start, 100 at a time, and follows a Jira that cuts a page shorter.
- **An issue matches** when one comment has the person as its author and was created in the window. The result gives each such
  comment's id and date, not its text; `comments` reads the text.
- **Four issues are read at a time,** and the call's cancel stops the reads at once.
- **One failed read is reported, not hidden.** The issue is named in the result with Jira's words, and is left out of the matches
  and out of the count of candidates checked.
- **Most failing stops the search.** With at least three failed reads, and more than half of the reads made, the call fails and says
  so, instead of working through hundreds of issues on a site that is not answering.
- **A page too large to read** (over 8 MiB with comments in it) is asked for again without them, and the comments are read per issue.

## Who is who

- **`me` is whoever is signed in.** The tool asks `GET /myself`. Some sites reach Jira through a sign-in proxy with no "who am I":
  there, set `jira.me` to your account id (Jira Cloud) or user name (Data Center). With neither, the call is refused and the message
  names the setting.
- **A person is matched by any identifier.** Account id, user name, key or email address, as the site provides them, without regard
  to case. Jira Cloud shows an email address only when the person allows it. A display name is not an identity.

## ScriptRunner

ScriptRunner is a Jira app that adds `issueFunction in commented("by <user> after <day> before <day>")`. Where a site has it, it
lists the candidates in one request. It never decides a match: its list goes through the same exact check.

| `jira.commentSearch` | What happens |
|---|---|
| `auto` (default) | The first search on a site tries ScriptRunner. If Jira says the function does not exist, that is remembered for the session |
| `scriptrunner` | Only ScriptRunner. A site without it gets an error that names the setting |
| `read` | Never tries it. Every candidate's comments are read |

- **A refused query falls back for that call only.** In `auto`, a 400 for another reason (the query itself) reads the comments this
  time and tries ScriptRunner again next time. Any other failure fails the search.
- **The days are widened by two on each side.** ScriptRunner's documentation does not say whether `after` and `before` take their
  own day in, and it reads a time in the server's zone. The extra days hold the window under either reading.
- **A person it cannot carry is read.** ScriptRunner's query takes letters, digits and `. _ @ : + -`; anyone else is read in `auto`
  and refused in `scriptrunner`.

## The result

The first line says who was asked about, the days, the matches among the candidates checked, and the method (`read` or
`scriptrunner`, and why ScriptRunner was not used). Then the query that listed the candidates, the issues that could not be read,
and the matches:

```text
Issues commented on by me (Jane Doe), 2026-10-01 to 2026-10-31 (days on your clock, both included): 1 match among 2 candidates checked. Method: read (every candidate's comments were read).
Candidates came from: (project = PROJ) AND updated >= "2026-09-30" ORDER BY updated DESC
PROJ-1 | In Progress | Fix login crash on Safari
    #10002 2026-10-03 10:00 +0000
```

- **Output limits:** 100 matches, 10 comments under each, 5 unreadable issues named. The rest is counted.
- **The call's record** carries the facts `candidates`, `matched`, `method` and `unread`.
- **Masking:** the result goes through jig-core's masking, as every read of this plugin does.
- **A JQL note** is added under the result when the JQL says `labels != x`, as for any `search` (see
  [Parameters](parameters.md)).

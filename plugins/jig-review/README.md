# jig-review: reviewing code in the browser

**Status: built.** A private browser review of the agent’s changes before anything is shared.

Adapted from `@dbaida/pi-interactive-code-review` (MIT).

`jig-review` opens a private, GitHub-style review of the agent's changes in your browser, before
anything is shared:
- a file tree;
- split or unified diffs;
- line comments, then **Ask** (one comment, now) or **Finish review** (all of them);
- **Approve**, with a passkey.

The comments reach the agent as a message, the agent answers each one, and the next round
shows what changed. **Approve** is in the header from the start, so a review with no comments is one click; if
draft comments are open it asks whether to submit them or discard them first, so none is dropped quietly.

For example, after the agent changes `orders-api`, `/code-review --branch` opens everything
since the branch left the main branch. You comment on two lines and Finish review, the agent
fixes one and answers the other, and you approve the second round with Windows Hello.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `start_interactive_code_review` | local write | Opens the review in your browser, as `/code-review` does |
| `record_interactive_review_resolution` | local write | The agent records how it handled each comment |

- **`start_interactive_code_review`:** its result never contains the page link, so the agent cannot use the page.
- **`record_interactive_review_resolution`:** the answer is `fixed`, `answered` or `wont-fix`, with a small diff and the lines it
  changed.

Neither can approve. Both are declared to `jig-core`, which classifies them as local writes.

## Commands

`/code-review` takes a ticket, a folder, or one of these scopes:

| Scope | What it reviews |
|---|---|
| (none) | with an active ticket, its bound repositories' branches; otherwise the uncommitted changes |
| `--branch` | everything since the branch left the main branch (`develop`, `main` or `master`) |
| `--staged` | staged changes |
| `--unstaged` | unstaged changes |
| `--touched` | the files the agent edited last and committed in that run, not what a merge brought in |
| `<folder>` | only the repositories in that folder, relative to Pi's folder |
| `<ticket>` | the repositories `jig-memory` bound to the ticket, whole branch (see below) |

`/code-review settings` toggles the settings and removes a passkey. One review covers every repository
with changes under Pi's folder, with file paths that start with the repository's folder.

**Ticket scope** reads `<ticket folder>/<KEY>/ticket.json`, where `jig-memory` lists the ticket's
repositories. The folder is the `memory` section's `folder` in `jig.json`. Without bound repositories
the command says that ticket scope needs `jig-memory` with bound repositories, and guesses nothing.

After an agent run that changed files, Pi offers to review them. The files come from git, taken when the
run starts and ends, so a change counts whatever tool made it. What came in from other commits (a merge, a
pull, a rebase) is not the agent's, so it is left out; when nothing else changed, Pi says so in one line
([What counts as the agent's](docs/run-changes.md)). The other scopes show everything in them.

## While a review is open

An agent-opened review holds the agent's non-read calls through `jig-core`'s gate until you answer or approve; reads and
`record_interactive_review_resolution` pass, a second refused write aborts the turn, and `holdAgent: false` turns the hold
off. A review you start with `/code-review` holds nothing while the agent is idle. The hold and its settings are in
[Rounds](docs/rounds.md).

## Approving

You approve in the page with a **passkey** (Windows Hello, Touch ID or a security key); the fallback marks the review
"approved in page" and Pi asks `y`. The page's server checks the signature, then the plugin records the approval, emits
`jig-review:approved` and tells the agent. The checks, the store and the fallback are in
[Passkeys](docs/passkeys.md).

## Rules

- **The page is local.** Served on `127.0.0.1`, on a random port, and opened at `localhost`, because a
  passkey cannot use an IP address.
- **Its link carries a per-session secret,** swapped for an HttpOnly cookie. The link goes only to you;
  a request without the cookie is refused, and a write that names an `Origin` other than
  this server's is refused too (a request with no `Origin`, as a program makes, is allowed;
  approval never rests on this check). See [Server security](docs/server-security.md).
- **Approval does not rest on the secret.** A stolen cookie can comment as you; it cannot approve.
- **Records are the agent's to read, not to write.** Reviews, settings and passkeys live under Pi's agent
  folder, which the file tools can read but not write and the sandbox's shell cannot reach. None of them is a
  secret: a passkey is a public key, and a review holds the diff the agent already knows.
- **Git goes through `jig-core`,** with hooks off and a repository's risky `.git/config` refused.

## Configure

`/code-review settings`, or the page's settings page:

| Setting | Default | Meaning |
|---|---|---|
| `autoAskReview` | `false` | Start the offered review without asking |
| `autoOpenBrowser` | `false` | Open the browser for it |
| `diffView` | `split` | `split` or `unified` |

## Company part (in the company plugin)

None. `jig-review` needs nothing from a company: it works on a repository's own git history.

## Later: after a checker agent

![A fresh-context checker: the maker hands over a ready commit; the checker reads the approved plan, the diff, the check results, the rules and earlier comments; a pass goes to your code review, a revise goes back to the maker, and after two rounds you decide](../../docs/img/fresh-checker.svg)

*A read-only checker agent in a fresh context reviews the change before this review (see [`jig-workflow`](../jig-workflow/README.md)):
it reads the approved plan, the diff, the check results, the rules and earlier review comments. A pass goes to your code
review; a revise goes back to the maker with findings, in the file and at the line; and after two rounds the decision comes
to you with both reports.*

## Layout

- `index.ts`: the entry Pi loads; it hands on to `src/index.ts`.
- `src/`: the implementation, its checks and the parts it runs on.
- `skills/`: none: the tool text is the entry.
- `test/`: the unit tests, fake hosts and real-program tests.

## More detail

**Use it**
- [The page](docs/page.md): Read before you change the page.
- [Rounds](docs/rounds.md): Read before you resolve a round.

**Trust it**
- [Passkeys](docs/passkeys.md): Read before you register a passkey.
- [Server security](docs/server-security.md): Read before you expose the page.
- [What counts as the agent's](docs/run-changes.md): Read before you judge a run.
- [Not verified yet](docs/not-verified.md): Read before you rely on it.

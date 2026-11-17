# jig-review

## Overview

A private, GitHub-style review of the agent's changes in the person's browser, before anything is shared: file tree, diffs, line comments, and an Approve that only the person can give (a WebAuthn passkey, or a `y` in Pi).

Comments reach the agent as a message, the agent answers with a tool, and the next round shows what changed. Human spec: [README](./README.md).

## Interface

- **Entry**: `index.ts` re-exports the default factory of `src/index.ts`, so Pi labels the extension `jig-review`. The factory registers only and starts no server until a review opens. Its `session_start` handler does write: in an interactive session it runs `cleanupStaleReviews` (see [src](./src/EGM.md)), which can delete or mark `abandoned` old review records before any review opens. The agent's start tool does the same in an interactive session; a headless one never cleans up.
- **Tools** (declared to `jig-core` as `local` / `write`): `start_interactive_code_review` (opens the review; its result never holds the link) and `record_interactive_review_resolution` (`fixed`, `answered` or `wont-fix`, with a small diff). Neither can approve.
- **Command**: `/code-review [--branch|--staged|--unstaged|--touched] [<folder>|<ticket>]` and `/code-review settings`.
- **Event**: `jig-review:approved` on `pi.events`, payload `ReviewApprovedEvent` (`reviewId`, `scope`, `ticket?`, `repos`, `covered`, `files`, `method`), read by `jig-workflow`'s `review-done` condition.
- **Config**: the `review` section of `jig.json` (`autoAskReview`, `autoOpenBrowser`, `diffView`, `holdAgent`, `holdAbortAfter`). The section is registered with a `setup` summary for `/jig setup`; per-person settings override it.
- **Gate**: `review-wait:<n>` denies the agent's non-read calls while a review it opened waits for the person; the two review tools above stay open (`src/hold.ts:13`).
- **Children**: [src](./src/EGM.md) (coordinator, server, store, approval, git sources) with [passkey](./src/passkey/EGM.md) (WebAuthn); [web](./web/EGM.md) (the React page and its committed build).
- **Docs** (specifications, in this folder): [Passkeys](./docs/passkeys.md), [Server security](./docs/server-security.md), [The page](./docs/page.md), [Rounds](./docs/rounds.md), [What counts as the agent's](./docs/run-changes.md), [Not verified yet](./docs/not-verified.md).
- **Tests** (not documented here): `test/` has one file per module plus a fake authenticator, fake Pi and fake `jig-core` under `test/support/`.

## Invariants

- **The agent cannot approve.** The only approving paths are a verified passkey signature and a `y` the person types in Pi, both inside `ApprovalService`. Never add a route, tool or setting that approves on a cookie or secret alone. This is the one web endpoint allowed to approve (repo rule); never add a second.
- **Approval vouches only for what was seen.** It is bound to the diff hash the page showed; commits are recorded as covered only for a `branch` review whose diff is unchanged.
- **The page is local**: `127.0.0.1`, random port, opened at `localhost`, per-session secret swapped for an HttpOnly cookie; the link goes only to the person, never into a tool result.
- **Records are the agent's to read, not write**: reviews, settings and passkeys live under `<agent folder>/jig-review/`, which the file tools cannot write and the sandbox's shell cannot reach. No secret is stored.
- **Git goes through `jig-core`** (hooks off, risky `.git/config` refused). A change under `web/src/` needs a rebuilt, committed `web/dist/`.
- **Pinned surface**: only the two tool names, the `code-review` command and the section name `review` are literals in `plugins/jig-core/test/plugin-surface.test.ts`. The event name and payload and the section's keys are pinned only by `plugins/jig-review/test/` and read by `jig-workflow`; change them with the README, `docs/rounds.md` and those tests in one commit.
- **Generic only**: no company names or hostnames; no sign-in flow and no stored credentials.

## Side Effects

- **Network**: one local HTTP server with an SSE stream; no outbound calls.
- **Disk**: `<agent folder>/jig-review/passkeys.json` (0600), `workspaces/<name>-<hash>/config.json` and `reviews/<id>.json` (0600, folders 0700); the shared theme file in the agent folder. Reads `<ticket folder>/<KEY>/ticket.json` only.
- **Processes**: `git` through `jig-core` (it can write unreferenced tree and commit objects into a reviewed repository's own object store, see [src](./src/EGM.md)); the browser opener (`$BROWSER` or the platform's), detached.
- **Pi**: follow-up user messages to the agent, status line `jig-review`, notices and confirms, aborts a turn after repeated refused writes during a hold.

## Verification

- Plugin code (from the repo root): `node --import ./test/support/host.mjs --test "plugins/jig-review/test/*.test.ts"`
- Web page: `npm --prefix plugins/jig-review/web test` and `npm --prefix plugins/jig-review/web run check`
- Docs: `node scripts/check-docs.mjs`
- Whole suite: `npm test` (repo root)

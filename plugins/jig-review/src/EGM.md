# jig-review src

## Overview

The plugin's code: a coordinator ties Pi events, the review records, a local web server and the messages to the agent. `src/index.ts` is the factory; the plugin-root `index.ts` only re-exports it so Pi labels the extension `jig-review`.

Specs: [Rounds](../docs/rounds.md), [Server security](../docs/server-security.md), [What counts as the agent's](../docs/run-changes.md), [README](../README.md).

## Interface

- **`index.ts`**: default `(pi: ExtensionAPI)` factory (registers only: no file written, no server started until a review opens); `DECLARATIONS` (both tools classified `local` / `write`); `registerReviewGate(coordinator, api)` registers gate `review-wait:<n>`.
- **`coordinator.ts`**: `ReviewCoordinator(pi, cwd, ReviewOptions)` with `register()`, `holdsAgent()`, `releaseHold()`, `noteHoldDenial()`, `runStartTaken()` and the private `cleanupStaleReviews(ctx)` (which skips a headless session); types `ReviewOptions`, `ReviewStart`. Handles Pi events `session_start`, `input`, `tool_call`, `turn_start`, `turn_end`, `agent_start`, `agent_end`, `session_shutdown`, and registers the `/code-review` command.
- **`tools.ts`**: `START_TOOL` (`start_interactive_code_review`), `RESOLUTION_TOOL` (`record_interactive_review_resolution`), `OPENED_TEXT`, `registerReviewTools(pi, handlers)`.
- **`server.ts`**: `ReviewServer(handlers)` (`start`, `stop`, `authorize`, `origins`, `publish`, `isRunning`), `COOKIE` (`jig_review`), types `ReviewServerHandlers`, `SubmittedCommentInput`, `CommentSubmissionMode`.
- **`approval.ts`**: `ApprovalService(host, store, origins, now?)` (`passkeys`, `removePasskey`, `registrationOptions`, `register`, `approvalOptions`, `approveWithPasskey`, `approveInPage`, `stop`), `ApprovalError(status, message)`, interface `ApprovalHost`.
- **`store.ts`**: `ReviewStore` (create, save, load, listAll, cleanupInactiveReviews, abandonOrDelete, addSubmittedComments, addIteration, addResolution, markPageApproved, clearPageApproval, approve), `hashDiff`, `STALE_REVIEW_MS`.
- **`settings.ts`**: `reviewRoot`, `workspaceDirFor`, `SettingsStore`, `DEFAULT_SETTINGS`, `parseReviewSettings`, `clampHoldAbortAfter`, `validateReviewSection` (the `review` section of `jig.json`).
- **`settings-options.ts`**: `formatSettingsOptions`, `toggleSelectedSetting`, `passkeyToRemove`, `REMOVE_PASSKEY`.
- **`types.ts`**: the record types the web page imports (`ReviewRecord`, `ReviewComment`, `ReviewResolution`, `ReviewIteration`, `ReviewSettings`, `ReviewApproval`, `ApprovalMethod`, `ReviewFileScope`, `ReviewStatus`, `PasskeySummary`).
- **`events.ts`**: `REVIEW_EVENTS.approved` (`jig-review:approved`), `ReviewApprovedEvent`.
- **`command.ts`**: `parseCodeReviewCommand`, `resolveSelectionFiles`. **`ticket.ts`**: `isTicketKey`, `ticketFolder`, `bindingPath`, `readBinding`, `activeTicket`, `TICKET_ENTRY`.
- **`git.ts`**: `GitReviewSource`, `jigGit`, types `Git`, `GitResult`, `ReviewFileSelection`. **`workspace.ts`**: `WorkspaceReviewSource`, `findRepositories`, `normalizeFolder`, `prefixDiff`, types `Repository`, `Target`.
- **Run tracking**: `run-tracker.ts` (`RunTracker`, `isHeadless`), `run-changes.ts` (`snapshotWorkspace`, `snapshotHeads`, `committedSince`, `changedBetween`, `parseStatus`, `MAX_CHANGED_PATHS`), `run-base.ts` (`snapshotReflogs`, `runBases`, `describeIncoming`), `used-repos.ts` (`repositoriesUsedBy`), `code-path.ts` (`isReviewableWrite`).
- **Small helpers**: `hold.ts` (`holdReason`, `WAIT_REASON`), `prompts.ts` (`buildReviewSubmissionPrompt`, `buildApprovalPrompt`, `describeApproval`), `approval-heads.ts` (`headsToRecord`), `diff.ts` (`filesOfDiff`), `file-filter.ts` (`filterReviewableFiles`), `open.ts` (`openUrl`).
- **Child**: [passkey](./passkey/EGM.md): WebAuthn, CBOR, challenges and the passkey store.

## Invariants

- **No approval path the agent can drive.** `ReviewServer` approves only through `ApprovalService`: a verified passkey signature (`approveWithPasskey`) or a `y` in Pi (`approveInPage`). Never add a route or tool that approves on a cookie or secret alone; `START_TOOL` must never return the page link (`OPENED_TEXT`).
- **Approval is bound to the diff the user saw.** Challenges carry `{ reviewId, diffHash }`; a changed diff, review id or status refuses with 409. The page must send `diffHash`.
- **One approval, registration or removal at a time** (`ApprovalService.exclusive`), since each may wait on Pi's single dialog slot. Questions go through `jig().approvals.inTurn` and time out after 5 minutes; the queue wait is 10 seconds.
- **Server access**: `127.0.0.1`, random port, `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, cookie `jig_review` (HttpOnly, SameSite=Lax) from the `?k=` link secret, `Origin` checked on non-GET when present, JSON bodies capped at 1 MiB, security headers (CSP `default-src 'self'` plus `style-src`, `img-src`, `frame-ancestors 'none'` and more, `nosniff`, `no-referrer`, `no-store`) on every response. They are added as the response leaves the server (`server.ts:83-90`, `withSecurityHeaders` at `:332-337`), so a refusal made before a route (a wrong `Host`, secret or `Origin`, a missing cookie), the cookie 302, an error reply and a handler's own response (a file, the event stream) carry them too. The event stream keeps its own `Cache-Control: no-cache, no-transform`, because a stream is never stored and must not be buffered.
- **Records**: whole-file writes, mode 0600 files and 0700 folders, under `<agent folder>/jig-review/` only. `ReviewRecord.approval` is present exactly when status is `approved`. A record that leaves `approved` — comments on it open it again, and a new iteration does too — drops `approval`, `approvedAt`, `approvedDiffAgainst`, `approvedHeads` and `commentsResolved` (`forgetApproval`, `store.ts:251-257`), so a later reader never takes an old approval for the current one. `approvedHeads` is recorded only for a `branch`-scope review whose current diff hash still matches the last iteration.
- **Cleanup is careful**: `cleanupInactiveReviews` touches only `awaiting-review` records older than 24 hours or whose `ownerPid` has exited, and never the active one; sessions in `isHeadless` mode (subagent children, `pi -p`) neither clean up nor snapshot. Both `session_start` and the start tool's `startOrOpenReview` go through `cleanupStaleReviews` (`coordinator.ts:354-361`, called at `:131` and `:445`), which returns at once for a headless session, so a subagent or `pi -p` never removes or abandons a pending review.
- **Hold rules**: `holdsAgent()` is true only for the review the agent opened (`agentRequestedReviewId`) while it is `awaiting-review`, the server runs and `holdAgent` is on. A person's `input` (source `interactive` or `rpc`) releases it; an extension-sent message must not. `holdAbortAfter` (1 to 10, default 2) refused responses abort the turn.
- **Git** runs only through `jig().exec.git` (hooks off); the touched scope starts from the run's start commit and leaves out commits that came in by merge, pull or rebase (`run-base.ts`).
- **Pinned surface**: `jig-core`'s `plugin-surface.test.ts` pins only the tool names, the `code-review` command and the section name `review`. The `jig-review:approved` payload and the section's keys are tested only in `plugins/jig-review/test/`; change them with the README, `docs/rounds.md` and those tests.

## Side Effects

- **Network**: one local HTTP server (`@hono/node-server`, `hono`) with an SSE stream at `/api/events` (15 second heartbeat); serves `../web/dist` statically, with the saved theme injected into `index.html`. No outbound calls.
- **Disk** (under `<agent folder>/jig-review/`): `passkeys.json`; `workspaces/<name>-<hash>/config.json`; `workspaces/<name>-<hash>/reviews/<timestamp-id>.json`. The theme file is written through `jig-core`'s `kit/theme-preference.ts` in the agent folder. The ticket binding `<ticket folder>/<KEY>/ticket.json` is only read.
- **Processes**: `git` via `jig-core`. When a run moved HEAD in a used repository and other people's commits came in (merge, pull, rebase), `run-base.ts` runs `git merge-tree --write-tree` and `git commit-tree`, writing unreferenced tree and commit objects into that repository's own object store. The browser opener via `jig-core`'s `browserCommand`, spawned detached (reads `$BROWSER`).
- **Pi**: `pi.sendUserMessage(..., { deliverAs: "followUp" })` to the agent on submitted comments and on approval of an agent-requested review; `pi.events.emit("jig-review:approved")`; status line key `jig-review`; user notices and confirms.
- **Env read**: `BROWSER`, `XDG_DATA_HOME`, `PI_SUBAGENT_ID`, `PI_SUBAGENT_CHILD`, `PI_CODING_AGENT_DIR` (through `getAgentDir`).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-review/test/*.test.ts"`
- Whole suite: `npm test`

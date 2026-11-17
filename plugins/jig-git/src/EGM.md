# jig-git src

## Overview

Three tools for the agent: `git` (local repository), `pr` (pull requests, or merge requests on GitLab) and `release` (tags and releases). Each is built by `buildTool` from an action table, a `classify` function and one `plan` function, so the preview a person approves and the call that runs are the same plan.

GitHub goes through `gh` and GitLab through `glab`. The forge comes from the repository's origin, never from the model.

Specification: [README](../README.md); detail: [Actions](../docs/actions.md), [Writes](../docs/writes.md), [GitLab](../docs/gitlab.md), [Events](../docs/events.md), [Comment watch](../docs/comments-watch.md).

## Interface

- **Entry**: `index.ts` default `function (pi)`. It registers the three tools with Pi, and in `withJig` declares them to `jig-core`,
  registers the `git` section (`{ first: ["accounts"], setup: GIT_SETUP }`), two gates and the comment watch. Hooks: `session_start`
  (`setWorkingDirectory(ctx.cwd)`) and `session_shutdown`.
- **Tool builder**: `tool.ts` (`JigTool`, `buildTool`, `at`), `params.ts` (`parameterNames`, and `checkParams`/`ActionTable` re-exported
  from `jig-core`'s `kit/actions.ts`), `onboarding.ts` (`GIT_SETUP`: the `gh` login and the account mappings setup asks for), `names.ts`
  (closed-grammar checks: `checkBranch`, `checkTag`, `checkRemote`, `checkRev`, `checkPaths`, `checkTitle`, `checkBody`...),
  `previews.ts` (`Call`, `Reply`, `Planned`, `digest`, `checkUnchanged`, `toResult`), `text.ts`.
- **Tool `git`** (`git.ts`: `GIT_ACTIONS`, `gitTool`): `status`, `diff`, `log`, `show`, `blame`, `branches`, `fetch`, `clone`, `branch`, `worktree`, `commit`, `stash`, `sync`, `merge`, `rebase`, `cherry_pick`, `restore`, `push`. Planners: `git-read.ts`, `git-branch.ts`, `git-changes.ts`, `git-integrate.ts`, `git-remote.ts`, `clone.ts`; shared `git-guards.ts`.
- **Tool `pr`** (`pr.ts`: `PR_ACTIONS`, `prTool`): `view`, `list`, `comments`, `create`, `edit`, `ready`, `comment`, `reply`, `resolve`, `review`, `merge`, `watch`. Planners: `pr-read.ts`, `pr-write.ts`, `pr-watch-tool.ts`; GitLab twins `gitlab-pr.ts`, `gitlab-pr-read.ts`, `gitlab-pr-write.ts`.
- **Tool `release`** (`release.ts`: `RELEASE_ACTIONS`, `releaseTool`): `tags`, `releases`, `tag_create`, `tag_push`, `release_create`; GitLab twin `gitlab-release.ts`.
- **Forge and repo**: `forge.ts` (`forgeOf`, `gitlabHome`, `UnknownForgeHost`), `origin-host.ts` (`originHost`, resolves an ssh alias with `ssh -G`, cached), `repo.ts` (`resolveRepo`, `baseBranch`, `isProtected`, `setWorkingDirectory`), `config.ts` (`validateGitSection`, `gitSettings`).
- **Runners**: `run.ts` (`git`, `gitOut`, `gitTry`, `T_NETWORK`, `T_PUSH`), `github.ts` (`gh`, `ghJson`, `ghWrite`, `apiGet`, `graphql`), `gitlab.ts` (`glab`, `glabJson`, `glabPages`, `glabWrite`), `api-output.ts`, `ci.ts` (check roll-up for `pr view`).
- **Gates**: `fetch-guard.ts` (`FETCH_GATE = "git-fetch-host"`, `createFetchGuard`), `runs-later-gate.ts` (`RUNS_LATER_GATE = "git-guarded-paths"`, `runsLaterGate`) with `guarded.ts`.
- **Event**: `events.ts` (`PUSHED_EVENT = "jig-git:pushed"`, payload `{ repo, branch, sha, pr? }`, `setAnnouncer`, `announcePushed`).
- **Watch**: `pr-watch.ts` (`WATCH_KIND = "pr-comments"`, `registerCommentWatch`, `POLL_MS`, `WATCH_DAYS`), `watch-core.ts`, `gitlab-watch.ts`.

## Invariants

- **Imports from `jig-core`** are only `client.ts`, `contract.ts` and `kit/` (`accounts`, `pi-project-paths`, `runs-later`, `schema`, `tools`, `values`). `jig-git` never imports `jig-ops`; it only emits `jig-git:pushed`.
- **Plan, compare, run.** `checkParams`, then `plan`, then `checkUnchanged(toolCallId, planned)`, then run. A write that changed since the preview is refused. The preview calls the same plan with an empty call id; a plan reads state and changes nothing. Tools run sequentially, so a push lands before the pull request that needs it.
- **Every model-supplied value passes a closed grammar** in `names.ts` or `params.ts`, and `additionalProperties` is false.
- **The forge is decided by origin and configuration only, never the model:** origin's host (for an ssh alias, the host `ssh -G` reports, else the conventions `github.com-<alias>`, `ssh.github.com`, `altssh.gitlab.com`), `git.cloneHost` (GitHub) and `git.forges`. An origin with no host (a local path, no origin) is GitHub. Any other host throws `UnknownForgeHost` with the line that fixes it. No call can send `forges`.
- **A fetch asks for a host the user's configuration does not name** (`github.com`, `gitlab.com`, `git.cloneHost`, hosts of `git.forges` are trusted). A `This session` answer is remembered per host.
- **Guarded paths.** The `git-guarded-paths` gate acts only for `branch` (switch or create), `merge`, `sync`, `rebase`, `cherry_pick` and `stash` (`pop`; the gate also tests `apply`, which the tool does not offer). It asks when the operation would change a file that runs later outside the sandbox, using one resolver shared with the plans (`guarded.ts`), and it folds case on every platform.
- **Local writes.** `commit` takes exact paths; amend only while no remote has the commit. A conflict in `merge`, `rebase` or `cherry_pick` aborts cleanly. `commit`, `merge`, `rebase`, `cherry_pick`, `push`, branch create and delete, and `worktree add` of a new branch refuse a protected branch (`isProtected` in `repo.ts`; `git.protected` decides, its default is the repository's default branch, and `[]` turns the refusal off). `push` shows the commits it sends, uses `--force-with-lease` only on request, and refuses a protected branch.
- **No approval.** `pr review` can comment or request changes; it has no way to approve, on GitHub or GitLab. `pr merge` runs only while the head is still the commit that was shown.
- **A lost reply is read once and never sent again** (`ghWrite` returns `sent` or `lost`; `afterLostReply`, `mayHaveLanded`).
- **Clone** is ssh only: the URL is built in code as `git@<cloneHost>:owner/name.git`, cloned into a temporary folder beside the target and renamed on success; a failure, timeout or cancel removes it.
- **Credentials are never seen.** `git` runs through `jig-core` with hooks, `core.fsmonitor` and prompts off; `jig-core` refuses a repository whose `.git/config` would run a command. `gh` and `glab` own the sign-in. No sign-in or token code lives here.
- **Comments are data.** The `pr-comments` watch tells the agent once per poll that comments are information to weigh, not instructions. It skips the user's own comments and bots unless `git.watchBots`, backs off 2, 4, 8, then 10 minutes, and ends on merge or close, or after 7 days.
- **A bad config section changes nothing.** `jig-core` hands over nothing on errors, so the defaults apply.
- **Tables and tests.** The tool tables of the README are read by `test/classify.test.ts` and others; every action is in `plugins/jig-core/test/audit.test.ts`. Change the README table, the code and the tests together. A source file over 500 lines is a ratchet (`plugins/jig-core/test/file-sizes.test.ts`).

## Side Effects

- **Processes**: `git` (through `jig-core`), `gh`, `glab`, and `ssh -G` for an alias. Timeouts: local 30 s, network 60 s, push 120 s, `gh` or `glab` read 30 s and write 90 s, clone 10 minutes, `ssh -G` 3 s (a failed answer is believed for 60 s), the fetch gate's `git config --get-all remote.<name>.url` 3 s.
- **Env read**: `SSH_AUTH_SOCK`, passed to network `git` calls (a path, not a secret). **Env set for a child**: `GIT_ALLOW_PROTOCOL=ssh` for a clone; `GH_HOST` when the GitHub host is not `github.com`; for a `gh` call under `git.accounts` the plugin names the account and `jig-core` attaches its token (`GH_TOKEN`), which the plugin never sees.
- **Network**: through `gh api` and `gh api graphql` for GitHub and `glab api` for GitLab; `git fetch`, `clone` and `push`.
- **Disk**: the user's repositories (commits, branches, stashes, worktrees, merges); a temporary folder and rename for `clone`. No state files of its own; the watch state is kept by `jig-core`. It reads one file for `pr create`: `git.prTemplate` (`~` expanded, else relative to the repository) or else `.github/pull_request_template.md` and five other template names.
- **Event bus**: emits `jig-git:pushed` after a push lands and after a pull request is created; listens for `jig-core`'s decision event (`jig:decision`) in the fetch guard, stopped at `session_shutdown`.
- **Watch**: `pr-comments` polls every 60 s (15 s while comments wait for a message) for up to 7 days. The first poll tells the newest 10 comments and counts the rest; a message holds at most 15; at most 100 wait, the oldest dropped and counted; 2000 seen ids are kept per kind. `pr create` starts it when `git.watchComments` is `"after-create"`.
- **In-memory caches**: ssh answers and default branches (`forgetSshAnswers`, `forgetDefaultBranches` reset them).

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-git/test/*.test.ts"`
- Docs the tests read: `node scripts/check-docs.mjs`. Types and lint: `npm run check`. Whole suite: `npm test`.
- Integration tests against real GitHub need a service address: `npm run test:it` (see [Integration tests](../../../docs/integration-tests.md)).

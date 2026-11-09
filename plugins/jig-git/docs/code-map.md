# jig-git: code map

Every file of `src/`, what it does and who calls it, and then one real call followed through the files.
Read it with the code open. Back to the [jig-git overview](../README.md).

## The files

| File | What it does | Called by |
|---|---|---|
| `api-output.ts` | The answer of `gh api -i` and `glab api -i`: a status line, the headers, a… | `github.ts`, `gitlab.ts`, `watch-core.ts` |
| `ci.ts` | What `pr view` says about the checks of a pull request, in one line. The… | `gitlab-pr-read.ts`, `gitlab-pr-write.ts`, `pr-read.ts` and 1 more |
| `clone.ts` | clone: fetch a GitHub repository into a new folder of the workspace. It runs… | `git.ts` |
| `config.ts` | The `git` section of jig.json: what it may hold, how it is checked, and the… | `events.ts`, `fetch-guard.ts`, `forge.ts` and 10 more |
| `events.ts` | The announcement of a push. jig-git does not watch CI, and it cannot import… | `git-remote.ts`, `gitlab-pr-write.ts`, `index.ts` and 1 more |
| `fetch-guard.ts` | Who a `fetch` talks to. A fetch is a read, and reads do not ask, but it is… | `index.ts` |
| `forge.ts` | Which forge a repository is on. The decision is made from the host of origin… | `events.ts`, `gitlab-pr-read.ts`, `gitlab-pr-write.ts` and 5 more |
| `git-branch.ts` | The git actions that put work on a branch: `branch` (create from the fetched… | `git.ts` |
| `git-changes.ts` | The git actions that deal with changes in the working tree: `commit` (exact… | `git.ts` |
| `git-guards.ts` | Checks the local-write actions of the `git` tool share: that a tree has no… | `git-branch.ts`, `git-changes.ts`, `git-integrate.ts` |
| `git-integrate.ts` | The git actions that bring other work in: `sync` (fast-forward from the… | `git.ts` |
| `git-read.ts` | The git actions that only read: status, diff, log, show, blame and branches.… | `git.ts` |
| `git-remote.ts` | The git actions that reach the remote: fetch, which only reads it, and push,… | `git.ts` |
| `git.ts` | The `git` tool: the local repository, and the remote write that goes with it… | `index.ts` |
| `github.ts` | GitHub, through the `gh` command. gh keeps its own sign-in, so this plugin… | `events.ts`, `gitlab-pr-write.ts`, `gitlab-release.ts` and 6 more |
| `gitlab-pr-read.ts` | Merge requests on GitLab, read only: view, list and comments, through `glab… | `gitlab-pr-write.ts`, `gitlab-pr.ts`, `gitlab-release.ts` and 1 more |
| `gitlab-pr-write.ts` | Merge request writes on GitLab: create, edit, ready, comment, reply,… | `gitlab-pr.ts` |
| `gitlab-pr.ts` | The `pr` actions on a GitLab project: which forge a call means, and where… | `pr.ts` |
| `gitlab-release.ts` | Releases on GitLab: `releases` lists them or shows one in full, and… | `release.ts` |
| `gitlab-watch.ts` | The comment watch on GitLab: what a poll reads, and which of it is a comment… | `pr-watch.ts` |
| `gitlab.ts` | GitLab, through the `glab` command. glab keeps its own sign-in (`glab auth… | `events.ts`, `gitlab-pr-read.ts`, `gitlab-pr-write.ts` and 2 more |
| `guarded.ts` | What a tree-moving git operation would change in the files that run later… | `git-branch.ts`, `git-changes.ts`, `git-integrate.ts` and 1 more |
| `index.ts` | jig-git: git, GitHub and GitLab for the agent. Three tools, `git`, `pr` and… || Pi |
| `names.ts` | Checks on every name, path and text the model supplies, before it reaches a… | `clone.ts`, `config.ts`, `fetch-guard.ts` and 13 more |
| `origin-host.ts` | The real host behind the host in origin's address. An ssh origin often names… | `fetch-guard.ts`, `forge.ts`, `github.ts` and 1 more |
| `params.ts` | What a tool with an `action` parameter accepts, written once: for each… | `git.ts`, `pr.ts`, `release.ts` and 1 more |
| `pr-read.ts` | Pull requests, read only: view, list and comments. Output is bounded plain… | `gitlab-pr-read.ts`, `pr-watch-tool.ts`, `pr-write.ts` and 1 more |
| `pr-watch-tool.ts` | `pr watch`: starts the watch on the comments of a pull request (see… | `pr.ts` |
| `pr-watch.ts` | The watch on the comments of a pull request. People answer a pull request on… | `gitlab-pr-write.ts`, `gitlab-pr.ts`, `index.ts` and 2 more |
| `pr-write.ts` | Pull request writes: create, edit, ready, comment, reply, resolve, review… | `gitlab-pr-write.ts`, `pr-watch-tool.ts`, `pr.ts` |
| `pr.ts` | The `pr` tool: pull requests and reviews on GitHub, through gh, and merge… | `index.ts` |
| `previews.ts` | Plan, preview, run. Each action works out what it would do (checks the… | `clone.ts`, `git-branch.ts`, `git-changes.ts` and 16 more |
| `release.ts` | The `release` tool: tags and releases. Creating a tag is local. Pushing a… | `index.ts` |
| `repo.ts` | Which repository a call means. The workspace is the folder Pi was started… | `clone.ts`, `events.ts`, `fetch-guard.ts` and 19 more |
| `run.ts` | git, through jig-core. jig-core starts git from an argument list with hooks,… | `clone.ts`, `fetch-guard.ts`, `git-branch.ts` and 17 more |
| `runs-later-gate.ts` | A git operation that changes the working tree can write a file that runs… | `index.ts` |
| `text.ts` | Small helpers for the plain text every jig-git tool returns to the model. | `git-changes.ts`, `git-guards.ts`, `git-integrate.ts` and 9 more |
| `tool.ts` | What the four tools have in common. A tool is its parameter schema, its… | `git.ts`, `index.ts`, `pr.ts` and 1 more |
| `watch-core.ts` | What the comment watch of both forges shares (see pr-watch.ts): what a watch… | `gitlab-watch.ts`, `pr-watch.ts` |

## One call: `git status`

1. **The action.** `index.ts` registers the tool with Pi. `tool.ts` calls `checkParams` (`params.ts`) and `classify`.
2. **The plan.** For `status`, `git.ts` calls `planStatus` in `git-read.ts`, which wraps the read in `readOnly` (`previews.ts`).
3. **The repository.** `git-read.ts` resolves the repository through `repo.ts`; `repoHere` runs `git rev-parse` through `exec.ts`.
4. **The command.** `statusOne` builds `git status --porcelain=v2 --branch` and runs it through `exec.ts`, with the sandbox and timeout.
5. **The answer.** `statusOne` formats the branch and paths; `tool.ts` adds the record and returns the text.

Back to the [jig-git overview](../README.md).

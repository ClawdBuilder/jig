# jig-ops ci

## Overview

The `ci` tool and everything behind it: one adapter per CI system (GitHub Actions through `gh`; GitLab, Jenkins and Concourse through jig-core's HTTP layer), the `ops-ci` background watch, a push-started auto-watch, and the two events other plugins read.

Every call is checked and classified from the ops catalog, and every write is previewed with a fingerprint and sent at most once.

- **Read with:** [README](../../README.md), [CI detail](../../docs/ci.md), [code map](../../docs/code-map.md).

## Interface

- **Tool** (`tool.ts`): `createCiTool(options)` returns `CiTool` with `definition` (name `ci`, `executionMode: "sequential"`), `classify(input)` and `preview(input, signal)`. `index.ts` wires it.
- **Input** (`params.ts`): `parameters` (TypeBox, `additionalProperties: false`) and `parseCall(input, catalog)`, which does no I/O. Limits: `MAX_LIMIT` 50, `DEFAULT_LIMIT` 20, `MAX_TAIL` 400, `DEFAULT_TAIL` 80, `MAX_PARAMETERS` 20.
- **Adapter seam** (`adapter.ts`): `CiAdapter` (optional `status`, `runs`, `run`, `log`, `rerun`, `trigger`, `watch`; required `poll`), `CiSystemInfo`, `CI_ACTIONS` (services, status, runs, run, log, rerun, trigger, watch), `FINISHES`, `Plan`, `WatchPlan`, `CiContext`, `ActionTable`, `supportedActions`, `usage`, `rowOf`.
- **Registry** (`adapters.ts`): `SYSTEMS` maps `github-actions`, `gitlab`, `jenkins` and `concourse` to `GITHUB_ACTIONS`, `GITLAB`, `JENKINS`, `CONCOURSE`. Each is exported by its adapter file (`github-actions.ts`, `gitlab.ts`, `jenkins.ts`, `concourse.ts`, with the action `TABLE`); their API calls are in `gitlab-api.ts`, `jenkins-api.ts`, `concourse-api.ts` (and `concourse-events.ts`) and, for GitHub checks and job logs, `github-checks.ts`.
- **Config** (`config.ts`, `settings.ts`): `checkCi`, `checkJob`, `CI_SYSTEMS`, `CiConfig`, `CiAuth` (token, basic, signIn, transport), `checkWatch`, `DEFAULT_WATCH`, `checkArtifacts`, `ArtifactRule`. `catalog.ts` calls them.
- **Watch** (`watch.ts`): `registerCiWatch(api, announce, options?)`, `CI_KIND` (`ops-ci`; registered interval 30 s, but each poll returns `nextPollMs` from `ops.watch.pollSeconds`, default 30, 5 to 3600, raised to GitHub's `x-poll-interval`), `CiSpec`, `CiState`, `CiWatchOptions`, `contextFor`, `describeSpec`. Per-system pollers live in `github-watch.ts`, `gitlab-watch.ts`, `jenkins-watch.ts` and `concourse-watch.ts`. `ops.watch.timeoutMinutes` (60) and `stallMinutes` (30) are passed to `watches.start`.
- **Auto-watch** (`autowatch.ts`): `createAutoWatch`, `listenForPushes`, `PUSHED_EVENT` (`jig-git:pushed`), `parsePushed`.
- **Events** (`finished.ts`, `artifacts.ts`): `CI_FINISHED_EVENT` (`jig-ops:ci-finished`), `announceFinished`, `ARTIFACT_EVENT` (`jig-ops:artifact-ready`), `addArtifacts`, `Announce`.
- **I/O helpers:** `gh.ts` (`gh`, `ghWrite`, `apiGet`, `apiJson`; `deploy/pin-github.ts` also imports `apiGet`), `request.ts` (`sender`, `RequestFailure`), `http.ts` (`httpFailure`, `jsonOf`), `lost.ts` (`afterLostReply`), `logs.ts` (`cleanLog`, `redactLog`, `selectLog`, `LOG_LINES` 400), `model.ts` (`Check`, `Bucket`, `judge`), `pin-line.ts` (`withPinnedLine`), `environment.ts`.

## Invariants

- **Effects come from the catalog, not the input.** `services` is a local read, `watch` a local write, `status`, `runs`, `run` and `log` reads, `rerun` and `trigger` writes. The environment is the CI entry's `environment` or `external`, so jig-core's floor sees the real host.
- **Unknown service, action or parameter is an `InputError`** naming the adapter and the usage line, so jig-core blocks the call before anyone is asked. An adapter that lacks an action has no row for it.
- **A write is previewed, then re-planned at execute.** The fingerprint of the approved preview must equal the new plan's, or nothing is sent ("changed since the preview").
- **A write is sent once.** A lost reply (timeout, broken connection) is read once by `afterLostReply` and never resent. Jenkins asks for its crumb first, so a failure there means nothing was sent.
- **Credentials never reach this code.** `gh` runs with an account picked from `git.accounts`; HTTP systems pass only a secret reference, a sign-in name or a transport name. Redirects are never followed. Replies over 4 MiB (`MAX_REPLY_BYTES`) are refused; log reads ask for 8 MiB (`LOG_BYTES`), and a `gh` log read is cut at 8 MiB (`maxOutputBytes`) rather than refused.
- **Arguments, never a shell.** `gh` gets an argument array and `-R owner/name` or a `repos/...` path from the catalog. Branch, ref, sha and parameter names are matched against patterns.
- **Watch specs hold names only** (service and what to follow), never an address or project. Each poll re-reads the catalog, and a spec whose system changed or is unknown fails.
- **`jig-ops:ci-finished` is published only** for a `passed` or `failed` watch with a repo and sha. A non-GitHub watch of an environment's job publishes nothing. A throwing listener never changes a result.
- **Auto-watch starts only** when `ops.watch.auto` is true and a catalog service has that repo and a CI entry. A newer push to the same service and branch stops the earlier watch. The push payload is untrusted and parsed.
- **Logs are cleaned, scrubbed and capped** (`redactLog` masks key blocks, GitHub and cloud tokens, JWTs and Bearer or Basic values). An unknown config field is an error.
- **A new CI system** is one file that exports `CiSystemInfo`, a name in `CI_SYSTEMS` and a row in `SYSTEMS`.

## Side Effects

- **Processes:** `gh` through `jig().exec.run` (reads 30 s, writes 90 s): `gh api`, `gh run list`, `gh run view`, `gh run rerun`, `gh pr checks`, `gh pr view`, and once per process `gh help api` (15 s) to probe for `--allow-escape-sequences`. A `trigger` preview also makes `gh api` reads of the environment's pin (`pin-line.ts` calls `deploy/pin-read.ts`).
- **Network** through `jig().http.request` (30 s timeout): GitLab `/api/v4/projects/...`, Jenkins `/crumbIssuer` and build endpoints, Concourse `/api/v1/teams/.../builds` and event streams.
- **Events:** publishes `jig-ops:ci-finished` and `jig-ops:artifact-ready`; listens to `jig-git:pushed` on Pi's event bus.
- **Watches:** `jig().watches.start`, `jig().watches.stop` and `jig().watches.list` (the auto-watch looks for the earlier watch before stopping it). Watch state is stored by jig-core as plain JSON.
- **Config reads** on every call: `ops` and `git.accounts`. No env vars and no disk writes. In-memory only: the last `gh` account, a cached `--allow-escape-sequences` probe, and the auto-watch map.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-ops/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

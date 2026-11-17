# jig-ops deploy

## Overview

The `deploy` tool: `plan`, `run`, `status`, `rollback` and `watch` for a service in an environment, through the method the ops catalog names. `helm` and `kubectl-image` run one command; `pin` (a version line in a control repository) is read-only. Production never deploys.

- **Read with:** [README](../../README.md), [Deploy detail](../../docs/deploy.md), [code map](../../docs/code-map.md).

## Interface

- **Tool** (`tool.ts`): `createDeployTool(options)` returns `DeployTool` with `definition` (name `deploy`, `executionMode: "sequential"`), `classify(input)` and `preview(input, signal)`. `DeployOptions` is `now` and `writeTimeoutMs`, for tests.
- **Input** (`params.ts`): `parameters`, `parseCall(input, catalog)` returning a `Call` or a `PinCall`, `usage`, `ACTIONS`, `VERSION` (image-tag pattern), `DEFAULT_WATCH_MINUTES` 15, `MAX_WATCH_MINUTES` 120. No I/O.
- **Methods** (`methods.ts`): `METHODS` (`helm`, `kubectl-image`, `pin`), `DeployConfig`, `CommandDeploy`, `checkDeploy` (called by `catalog.ts`), `deployerOf(config)`; there is no deployer for `pin`.
- **Method seam** (`command.ts`): `Deployer` (`method`, `deploy(kube, version)`, `rollback(kube)`), `Command` (data, never a shell string), `Rollback`, `lineOf` (display only).
- **Methods' code:** `helm.ts` (`helmDeployer`, `checkHelm`, `startHelm`, `HELM_READ`, `HELM_CHANGE`) and `kubectl-image.ts` (`kubectlImageDeployer`, `checkKubectlImage`).
- **Plan and run:** `plan.ts` (`planRun`, `planRollback`, `refusal`, `Plan`), `execute.ts` (`startCommand`, `lookOnce`, `checkUnchanged`), `actions.ts` (`planAction`, `runAction`, `rollbackAction`, `statusAction`, `watchAction`, `Context`), `records.ts` (`createRecords`, `Records`).
- **Pins** (read only): `pin-config.ts` (`checkPin`, `checkPinned`, `PinSource`, `PinDeploy`), `pin-plan.ts` (`planPin`, `planPinAction`), `pin-status.ts` (`statusPinAction`, `readPinned`), `pin-read.ts` (`readPins`, `matchLine`, `readHolder`), `pin-github.ts` (`fileAt`, `lastCommit`, `branchTip`, `openPullRequests`).

## Invariants

- **Production is refused before anyone is asked.** An environment with no catalog `deploy`, a rollback outside a `test` environment, and a name jig-core does not know are refused in `classify`, again in `preview` and `execute`, as an `InputError`.
- **`classify` reads the catalog on purpose** (the environment kind and the method decide the refusal). Do not make it pure: see [Catalog](../../docs/catalog.md).
- **A version must look like an image tag** (`VERSION`), or match the pin's own pattern. Commands are argument lists. The only writes are `helm upgrade --install`, `helm rollback`, `kubectl set image` and `kubectl rollout undo`. `startHelm` allows exactly four helm commands (`helm.ts:187-195`): those two writes and the reads `history` and `get values` (used to plan a rollback), and refuses the rest.
- **The image tag is the last `--set`** of `helm upgrade`, so no earlier value can override it.
- **The preview is tied to a fingerprint** of the action, service, environment, method, exact argv, running tags and target. `run` and `rollback` plan again, and `checkUnchanged` stops with "changed since the preview ... Nothing was run".
- **A command is started once.** A timeout or cancel gives an unknown outcome; `lookOnce` reads the rollout one time, and the command is never run again unless the user says so. Exit 0 is `started`, nonzero is `failed`. The tool never waits for the rollout: `watch` does.
- **A pin has no deployer.** `run` and `rollback` of a pin are refused; only `plan` and `status` reach the pin code. A pin file must match exactly one line: none or several is refused with line numbers, never the line's text.
- **Pin reads are `gh api` GETs** with repository, branch and file paths from the catalog. A 401 tells the user to sign in themselves.
- **`status` of several environments is classified in the most restricted kind** (local, test, external, production).
- **`watch` reuses an open watch** with the same title, and its deadline is 5 s before the engine's. It is a local write.
- **A new method** is a file beside `helm.ts`, a case in `checkDeploy` and `deployerOf`, and a name in `METHODS`.

## Side Effects

- **Processes:** `helm` through `jig().exec.run` (reads 30 s and 4 MiB, changes 6 min and 1 MiB, a cut change keeping both ends) and `kubectl set image` or `kubectl rollout undo` through `startKubectl` in [`runtime/kubernetes/kubectl.ts`](../runtime/kubernetes/EGM.md). Plan, run, rollback, status and the read after an unknown outcome also run kubectl reads: `look` (`get pods`, `get deployments,statefulsets`) and, in `kubectl-image.ts`, `get` of the one workload, `get replicasets` and `get controllerrevisions`. Pin reads start `gh api` through `ci/gh.ts`; `ci/pin-line.ts` calls `readPin` too, so a CI trigger preview reads the pin.
- **State:** `createRecords` keeps the last deploy per service and environment in memory for the session; it is lost on restart.
- **Watches:** `jig().watches.start` for the `ops-rollout` kind, and `jig().watches.list` to find an open one.
- **jig-core reads:** `config.section("ops")`, `environments.kindOf`, `approvedPreview(toolCallId)`, and `addFacts` on every execute.
- **No disk writes and no events.** A pin changes nothing in its repository.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-ops/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

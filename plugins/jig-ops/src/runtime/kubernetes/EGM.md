# jig-ops runtime/kubernetes

## Overview

The Kubernetes adapter: the one place kubectl is built and started, the validator of an environment's `runtime.kubernetes` entry, and the read actions `pods`, `rollout`, `logs`, `events` and the in-pod health check.

Pure functions turn pod and workload JSON into a rollout verdict. The deploy methods and the `ops-rollout` watch reuse them.

- **Read with:** [README](../../../README.md), [Runtime detail](../../../docs/runtime.md), [code map](../../../docs/code-map.md).

## Interface

- **kubectl runner** (`kubectl.ts`): `startKubectl(kube, verb, args, limits)`, `runKubectl`, `readKubectl`, `getJson`, `argvOf`, `READS`, `WRITES`, `Verb`, `Kube` (`{ target, signal }`), `Limits`, `READ`, `LOGS`, `CHANGE`, `cutMark`, `wasCut`, `programEnvironment`.
- **Config** (`config.ts`): `checkKubernetes(raw, at, errors)`, `Target`, `KubernetesEntry`, `DNS_LABEL`, `DNS_SUBDOMAIN`. `catalog.ts` calls the validator.
- **Pods** (`pods.ts`): `listPods`, `parsePod`, `firstReady`, `tagOf`, `podLine`, `Pod`, `Container`, `podsAction(kube, now)`.
- **Rollout** (`rollout.ts`): `listWorkloads`, `evaluate(pods, workloads, version)` (pure), `verdictLine`, `workloadLines`, `podLines`, `Verdict`, `Rollout`.
- **Wait** (`wait.ts`): `look(kube, version)`, `render`, `rolloutAction(kube, ask, deps)`, `Waiting`, `Snapshot`, `nextDelay`, `POLL_FIRST_MS`, `POLL_MAX_MS`.
- **Actions:** `logsAction` (`logs.ts`), `eventsAction` and `MAX_EVENTS` 30 (`events.ts`), `inPodHealth` and `curlArgs` (`inpod.ts`).
- **Failures** (`failure.ts`): `explain(stderr, code, what, target, access?)` for kubectl and helm complaints, `firstLines`.

## Invariants

- **kubectl starts only in `kubectl.ts`,** through `jig().exec.run("kubectl", argv)` with an argument array, never a shell. Every command begins with `--request-timeout`, `--context` and `--namespace` taken from the catalog `Target`, never from the model.
- **The verbs are a closed list.** `READS` are `get`, `logs` and `exec`; `WRITES` are `set image` and `rollout undo`. Anything else (`delete`, `scale`, `apply`, `edit`, `port-forward`) cannot be built. Only `deploy/execute.ts` starts a write; only `inpod.ts` uses `exec`.
- **In-pod health is a fixed `curl`** (`-sS -m 20 -X GET`) to `localhost:<port><healthPath>` from the catalog. The model gives no path, method, header or body. It uses the first Ready, non-terminating pod, and nothing is installed in it. `runtime/tool.ts` refuses it in production.
- **`checkKubernetes` rejects unknown fields.** A context must not start with `-`; a selector is 1 to 10 `key=value` pairs; `healthPath` starts with `/`, has no `..` even after percent-decoding, and needs `port` and `container` with it.
- **Pod and container names are checked** against `DNS_SUBDOMAIN` and `DNS_LABEL` before they reach argv. `logs` reads only a pod the selector lists.
- **The verdicts are `running`, `rolling`, `failing` and `no-pods`.** `failing` is checked first (a pod waiting in CrashLoopBackOff, ImagePullBackOff, ErrImagePull, CreateContainerConfigError or InvalidImageName). `running` needs enough live pods, all Ready, and all on the version; with no `version` (a rollout without `waitFor`, the status of a failed deploy) the pods only have to agree on one set of tags (`rollout.ts:110-119`). Terminating pods are ignored.
- **A wait ends on `running`, `failing` or timeout,** all as results. Polling starts at once, then 2 s, times 1.5, capped at 15 s. A stopped call says the rollout itself is unaffected.
- **Limits:** `READ` 30 s and 8 MiB, `LOGS` 60 s and 2 MiB, `CHANGE` 60 s and 1 MiB, in-pod 35 s and 2 MiB (`API` in `inpod.ts`). A cut reply keeps the end of the output (`keep: "tail"`), or both ends for a change (`keep: "both"`), and is never parsed as JSON or as an HTTP status.
- **Events** keep only objects of this service (its pods, deployments, statefulsets, owned replicasets), the latest 30, each message cut to 300 characters.
- **`explain` shows the first lines of stderr only,** with credentials in URLs removed.

## Side Effects

- **Process:** `kubectl` through jig-core's exec, with the environment limited to jig-core's short list plus `KUBECONFIG` when set. Subcommands: `get pods`, `get deployments,statefulsets`, `get replicasets`, `get events`, `logs`, `exec ... curl`, and, from the deploy folder through the same runner, `get <deployment or statefulset>/<name>` and `get controllerrevisions` (`deploy/kubectl-image.ts:114,140`) and the writes `set image` and `rollout undo`.
- **Network:** kubectl talks to the API server of the catalog's context. This code stores no credential.
- **Timers:** each process has a kill timeout; a wait sleeps between reads and reports progress.
- **No disk writes, no module state.** The only env var read is `KUBECONFIG`.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-ops/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

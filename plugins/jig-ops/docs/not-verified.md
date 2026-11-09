# Not verified

What the tests of `jig-ops` do not cover. Back to the [jig-ops overview](../README.md).

The tests in `test/` run against a fake `kubectl`, a fake `helm`, a fake `gh` and fake GitLab, Jenkins and Concourse servers on this machine.
The tests in `test/it/` run the same code against a real Kubernetes cluster and Helm, real GitHub, and a real HTTPS server, in the
`integration` job of CI (see [Integration tests](../../../docs/integration-tests.md)). Nothing has been tried against a real GitLab,
Jenkins or Concourse.

## Verified in CI

A kind cluster (Kubernetes 1.37) with Helm 4.3 in one run and Helm 3.22 in the other, and the repository's own workflow runs on GitHub. The Kubernetes flows were also run on
this repository's machine against a real API server, controller manager and scheduler with Helm 3.19 and Helm 4.3.

| Area | How |
|---|---|
| `helm upgrade --install ... --wait=false` of a real chart; the rollout watch ending `passed`; the pods and workload as the cluster shows them | `cluster.test.ts` |
| `helm history --max 2 -o json` and `helm get values --revision N --all -o json`, which a rollback's "going back to" line relies on | `cluster.test.ts` |
| `helm rollback`, and a rollback that restores the image pinned by tag and digest | `cluster.test.ts` |
| "Changed since the preview" when the versions that run change, and no refusal when only a pod is replaced | `cluster.test.ts` |
| A version that does not exist: the watch ending `failed`, the rollout `Failing`, and a rollback that recovers | `cluster.test.ts` |
| `kubectl set image` (tag only, digest taken off) and `kubectl rollout undo` on a real deployment | `cluster.test.ts` |
| The words for a context nobody has, a release that was never installed and a chart that is not there | `cluster.test.ts` |
| `runtime` logs, previous-run logs, events (core API and events API), and `curl` in a pod | `cluster.test.ts` |
| Production is read, never deployed to, and no command runs in its pods | `cluster.test.ts` |
| A job log read by `gh` 2.92 and by `gh` 2.103, which needs `--allow-escape-sequences` | `ci-github.test.ts`, `github.test.ts` |
| The GitHub Actions adapter reading this repository's runs, a run's jobs, the checks of a commit and a job log, with a run's own token and read-only permissions; a token GitHub refuses | `github.test.ts` |
| The pin reads of `deploy status` and `deploy plan`: a file at a fixed commit and the last commit that touched it, as GitHub's contents and commits APIs answer, with the token Actions gives the run; a file that is not there | `pin.test.ts` |
| Health by address over HTTPS: a certificate nobody trusts, one whose authority is trusted, a redirect that is not followed, a long body, terminal sequences, a service that never answers, and a refused connection | `health.test.ts` |

## Not verified

### Helm

- **`helm upgrade --install ... --wait=false` with hooks.** Helm waits for hooks, such as a pre-upgrade migration job, for up to five
  minutes even without `--wait`.
  - The tool allows six, so that it is helm that gives up and not this plugin that stops it.
  - A helm that is stopped part way can leave a release in `pending-upgrade`; the tool treats that as an unknown outcome and says that a
    locked release is the user's to look at.
- **helm's own words** for an expired sign-in, an unreachable cluster and a locked release (`another operation (install/upgrade/rollback)
  is in progress`). Another version may word them differently, and the tool then shows helm's first lines instead.
- **Helm 4 server-side apply.** Helm 4 stops an upgrade that finds a field another tool changed (it said so for a `kubectl scale`). The tool
  reports helm's words and does not retry.
- **A chart that does not take the version as `image.tag`.** The deploy would succeed and change nothing. The rollback preview shows `its
  version could not be read`.

### Kubernetes

- **kubectl's own words** for an expired or refused sign-in, an unreachable cluster, a forbidden read or change, and a container that has
  not started.
- **`kubectl rollout undo` on a paused deployment,** a StatefulSet and a DaemonSet, and the revision `rollout undo` chooses. The Deployment
  case was run.
- **`kubectl exec` and `curl` in a container image without `curl`** and the exit codes `kubectl` passes on.
- **Rollouts that are not a deployment or a statefulset** (a daemonset, a rollout controller of another product), and a statefulset
  updated with `OnDelete`. They are judged from their pods.
- **A kubeconfig sign-in helper that needs Pi's environment.** Only `KUBECONFIG` is passed on.

### Health addresses

- **A company certificate authority through `NODE_EXTRA_CA_CERTS`.** The test trusts its own authority from inside the process.
- **`fetch` refuses some low ports before it connects** (port 1 is one), and the check then says only that the connection failed.

### `jig-core` in a live session

- **The watch engine.** The kind was polled directly, with a fake clock. The first
  poll about two seconds after the start, the ten-second interval, the stall
  notice, the single message to the agent and the saved file were read in
  `jig-core`'s code and not run in Pi.
- **The kind of an environment.** The tools ask `jig-core` for the kind of a name
  on every call; the fake answers like `jig-core` does (a name nobody defined is
  production), but the real answer was read in its code, not run.
- **Programs found on `PATH`.** `jig-core` does not run a program found only in a
  folder the agent can write to. `kubectl` and `helm` are assumed to be installed
  in a system folder.
- **The review screen** of a preview, and the masking of a production result, were
  not seen in the terminal.
# Deploy: plans, previews, and why a command is never sent twice

What the `deploy` tool does, the exact commands it can start, and what it
promises when one goes wrong. Back to the [jig-ops overview](../README.md).

| Parameter | Used by | What it does |
|---|---|---|
| `action` | all | `plan`, `run`, `status`, `rollback` or `watch` |
| `service`, `environment` | all | Names from the [catalog](catalog.md), as for `runtime`. `status` may leave out `environment` |
| `version` | `plan`, `run`, `watch` | An image tag: 1 to 128 letters, digits, `.`, `_` and `-`, not starting with `.` or `-` |
| `ticket`, `values` | `plan`, `run` | Only for a [pin](#pins): the ticket it is made for, and values of its line a call may set |
| `timeoutMinutes` | `watch` | How long to watch: 1 to 120, 15 by default |

A call can name no release, chart, values file, value, image, context, namespace,
flag or verb: those are the catalog's.

The version is the only text of a call that reaches a command line, and it is
checked to be an image tag. That is stricter than what `runtime rollout` accepts to
wait for, because this one is written into a cluster: it can never be read as a
flag, a digest or a second argument.

## The commands

The only writes this plugin can make are these four. Context, namespace, release,
chart, values and workload come from the catalog.

**`helm`** deploys with:

```text
helm upgrade --install <release> <chart> --kube-context <context> --namespace <namespace> [--values <file>] [--set <key>=<value>]... --set image.tag=<version> --wait=false
```

and goes back with:

```text
helm rollback <release> --kube-context <context> --namespace <namespace>
```

**`kubectl-image`** deploys with the following, with the context and namespace first, and goes back with
`kubectl rollout undo <workload>`:

```text
kubectl set image <workload> <container>=<image>:<version>
```

- **The version is the last `--set`,** so nothing before it can win over it, and
  `image.tag` cannot be set in the catalog.
- **Only the tag changes with kubectl.** The image is read from the workload as it
  is now, its tag and digest are taken off, and the version is put on instead, so
  a deploy cannot move a service to another registry or repository.
- **No flag that skips a check, forces a change or waits.** `--wait=false` is the
  point: the deploy returns when the cluster has accepted it, and the rollout is
  watched separately.
- **Started from an argument list, never a shell,** through `jig-core`'s `exec`,
  with its short environment plus the path of the kubeconfig. A relative chart or
  values file is read from the folder Pi was started in.

The helm and kubectl commands that only read, to find the version a rollback goes
back to, are `helm history`, `helm get values` and `kubectl get`.

For an environment with a pin, `version` is checked against the pin's own `version` pattern instead, from end to end.

## Plan

`deploy plan` reads the rollout and says what runs now, what is asked for and the
command, and whether the version is already running. In an environment where the
agent does not deploy (production, or no method in the catalog) it says why a
`run` would be refused, and still says what runs. It asks nobody.

## Run and rollback: the preview and the run

Both are writes in the environment. By default `jig-core` asks the user, and the
floor denies a write to production. The screen it shows is the **preview**:

```text
Service:       orders-api
Environment:   staging (test)
Method:        helm
Running now:   1.4.2
Deploying:     1.4.3
Command:       helm upgrade --install orders-api deploy/chart --kube-context staging ...

The command runs once, without a shell. If it is cut short, whether it took effect is unknown, and it is not run again.
```

A rollback shows `Going back to: revision 4, which ran 1.4.2` instead.

**The fingerprint** is a digest of the service, the environment, the method, the
exact argument list, the versions running now and where the command goes.
- **It changes** when the version asked for, the versions running, the command or the service changes.
- **It does not change** when pods are scaled or become unready, because those are not a change of version.
- **The digest rule** is in [Approvals](../../../docs/approvals.md#preview-digest-and-a-lost-reply): the run plans again with the
  cluster as it is, and a changed fingerprint refuses and names the versions that run now.

**What the preview does not show** is the contents of the chart or the values
file: they are files on disk. A chart edited after the preview is not noticed.

### Where a rollback goes back to

- **Helm:** `helm history --max 2` gives the last two revisions, and `helm get
  values --revision <previous> --all` gives the previous one's `image.tag`. A
  release with one revision has nothing to go back to. A chart that does not take
  the version as `image.tag` shows `its version could not be read`.
- **kubectl:** the second newest revision, as `kubectl rollout undo` picks it: the
  replica sets of a deployment, numbered by an annotation, or the controller
  revisions of a statefulset. Only the objects the workload owns are read.

A rollback is for test environments only: `jig-core` must say the environment is
`test`, not `local` or `external`.

## Pins

An environment whose `deploy` is a `pin`, or that has a read-only `pinned` entry ([the catalog](catalog.md#pin)), has its version
in a line of a control repository. `deploy status` and `deploy plan` read it through `gh api`: the file at the branch that
deploys, the last commit that touched it, the branch tips and the open pull requests. They write nothing, and ask nobody.

### Status

`deploy status {service, environment}` says, per environment: what the branch pins, the ticket that holds it, who changed it last and
when, the open pull requests that would change it, and, where the environment has a runtime, what the pods run.

```text
checkout
- staging: main pins 0.0.0-pr-feature-PROJ-41-1a2b3c4 (PROJ-41), changed by A. Person 2026-11-01 10:10 UTC, PR #88; open pin PR #91 "PROJ-60: deploy checkout 1.4.4 to staging" by bperson; Running: 2 of 2 pods ready on 0.0.0-pr-feature-PROJ-41-1a2b3c4.
- production: main pins 1.4.2, changed by A. Person 2026-10-28 08:02 UTC, PR #80.
```

- **Without `environment`** it reads every environment of the service that has a pin, in the catalog's order, and a service with no pin
  is refused with its environments. GitHub is asked for the open pull requests once per repository and branch.
- **It is classified in the most restricted environment it reads,** so one answer that includes production is masked as a whole.
- **The holder** is the ticket the `holder` pattern finds on the first pin's line. Who changed it last is the last commit on `base`
  that touched that file: its author, date and the `(#12)` a squash merge ends its subject with. A commit that cannot be read leaves
  the ticket and says so.
- **Open pin pull requests** are those from a branch in the repository itself (not a fork) that the `branch` template could make for
  this service and environment. Only one page, the newest 100 open pull requests, is read.
- **Exactly one line.** A file with no matching line, or two, is refused with the line numbers and never their text. One environment
  that cannot be read is one line saying why, and the others are still read. Pin files that disagree are named.

### Plan

`deploy plan {service, environment, version, ticket?, values?}` shows what a run would change, without writing:

```text
Service:       checkout
Environment:   staging (test)
Method:        pin, in acme/deploy-control on main
Holder:        staging is pinned for PROJ-41 (0.0.0-pr-feature-PROJ-41-1a2b3c4, changed by A. Person 2026-11-01 10:10 UTC, PR #88); this replaces it with PROJ-57.
File:          clusters/staging/checkout/chart.version (line 1)
Line:          0.0.0-pr-feature-PROJ-41-1a2b3c4 -> 0.0.0-pr-feature-PROJ-57-9f8e7d6
Branch:        deploy/PROJ-57-staging-checkout (new, from main at 4d5e6f7)
Pull request:  PROJ-57: deploy checkout 0.0.0-pr-feature-PROJ-57-9f8e7d6 to staging (new)
Next:          a person merges it; then the staging job applies it.
```

- **The new line** is the pin's `write` with the version, the ticket and the values filled in. A value a call does not set keeps the
  current line's. The plan refuses a new line that the pin's own `line` pattern would not read back.
- **The branch** is new, or exists and would be moved to the head of `base`; **the pull request** is new, or an open one from that
  branch that would be edited.
- **Already pinned** to the line a run would write says there is nothing to change, and the branch and pull requests are not read.
- **A fingerprint** covers the files and their blob shas, the new lines, the heads of `base` and of the branch, the open pull request
  and the last commit. It is in the result's details, for the run that comes later to compare.
- **Production** and any environment with no `deploy` get what a plan says elsewhere: a run would be refused, and why, and then
  what the branch pins now.

### Run and rollback

`deploy run` and `deploy rollback` of a pin are refused, naming the reason, before anyone is asked and before GitHub is read.
`run` is not available yet; a pin goes back by pinning the previous version, which `run` will do. The change a plan shows is a
one-line pull request that a person can make by hand meanwhile.

## No resend

The general rule is in [Approvals](../../../docs/approvals.md#preview-digest-and-a-lost-reply).
A command is started **once**. It ends in one of three ways:

- **It exited with `0`:** the deploy is `started`. The model is told that nothing waits for the rollout.
- **It exited with an error:** the deploy `failed`, and the error is one line that says whose it is to fix (sign-in, network, a
  locked release, a missing release or chart). It is not retried.
- **It was cut short:** it ran longer than its limit, or the user cancelled the call while it ran. The limit is helm six minutes
  (longer than helm's own five for hooks) and kubectl one minute.

A command that was cut short has an **unknown outcome**: it may have reached the
cluster. The tool then reads the rollout once, even if the call was cancelled, and
returns an error that:
- shows what the cluster shows;
- says it was not run again;
- tells the model to check `deploy status` and the user before doing anything else.

A second deploy on top of an interrupted helm upgrade can leave a release locked. A
program that could not start (it is not installed) ran nothing, and says so.

## Status

`deploy status` says what the last deploy or rollback **run from here** did and
how it ended (`started`, `failed`, or cut short), and then the rollout, judged
against the version that deploy put on. The record is kept in memory for the
session: the cluster is the truth, and `status` always reads it. Every call is also
in `jig-core`'s records.

## Watch

`deploy watch` starts the `jig-core` watch kind **`ops-rollout`** and returns its id
at once. It is a write on this machine and changes no environment, so it asks
nobody; it also works for an environment the agent does not deploy to. The engine
polls it every 10 seconds, saves its state, and sends the agent one message:

| Outcome | When |
|---|---|
| `passed` | Every pod is ready on the version, and there are as many pods as the workloads want |
| `failed` | A pod waits for a reason that does not pass by itself (`CrashLoopBackOff`, `ImagePullBackOff`, ...) |
| `timed-out` | The deadline came. The message says how far the rollout got and how long it waited |

The saved spec holds the service, the environment and the version, never a context
or a namespace: every poll finds them in the catalog as it is then.
- **The watch's own deadline** is five seconds before the engine's, so the last poll is the kind's and can say how far the rollout
  got.
- **A watch for the same rollout** that is already open is returned, not started twice.
- **A poll that cannot read the cluster** is a failed poll, which the engine counts: three in a row pause the watch with a notice.

# jig-ops src

## Overview

The code of the `ops` plugin: the service catalog (`catalog.ts`), the plugin factory (`index.ts`), the `ops-rollout` watch (`watch.ts`) and small shared helpers (`values.ts`). The three tools `ci`, `deploy` and `runtime` are in child folders.

A call names a service and an environment, and the catalog says where that is, so nothing outside the catalog can be reached.

- **Read with:** [README](../README.md), [The catalog](../docs/catalog.md), [code map](../docs/code-map.md).

## Interface

- **Factory** (`index.ts`): `jigOps(options?)` returns an `ExtensionFactory`; the default export is `jigOps()`. `OpsOptions` is `RuntimeOptions & DeployOptions & CiWatchOptions`, the parts a test replaces. Inside `withJig` it registers the `ops` section (`validateOps`, `OPS_REPLACE`, `OPS_METHODS`, a `setup` summary), declares the three tools, and registers the `ops-rollout` and `ops-ci` watch kinds. It then registers the tools with Pi and `listenForPushes`.
- **Catalog** (`catalog.ts`): `readOps` (errors, or a `Catalog`), `validateOps`, `catalogOf(raw)` (cached per raw object), `OPS_REPLACE` (`services.*.ci.auth`, `services.*.environments.*.job.auth`, `services.*.environments.*.deploy`), `notSetUp`, `healthProblem`, `describeServices`, `nearestName`, `findService`, `findEnvironment`, `findCiService`, `ciServicesOfRepo`, `pinOf`. Types: `Catalog`, `Service`, `Environment`, `CiService`.
- **Rollout watch** (`watch.ts`): `registerRolloutWatch(api, options?)`, `KIND` (`ops-rollout`), `RolloutSpec`, `RolloutState`, `titleOf`, `RolloutOptions`. Polls every 10 s.
- **Helpers** (`values.ts`): `InputError`, `isObject`, `oneLine` (re-exports of jig-core's kit), `classifying`, `previewing`, `checkPattern`, `objects`, `count`, `str`, `shown`, `shortList`, `plural`, `duration`, `digest`, `clean`, `linesOf`, `utc`, `Outcome`.
- **Children:** [`ci/`](./ci/EGM.md) (CI adapters, watch, events), [`deploy/`](./deploy/EGM.md) (plan, run, rollback, pins) and [`runtime/`](./runtime/EGM.md) (reads of a service's state; Kubernetes in `runtime/kubernetes/`).

## Invariants

- **Unknown config fields are errors,** and with any error there is no catalog, so the tools do nothing until the file is fixed. A misspelt key never becomes a silent default.
- **A call never names a context, namespace, release or address.** The catalog does. Service names match `[A-Za-z0-9][A-Za-z0-9._-]{0,39}`, environment names `[A-Za-z][A-Za-z0-9_-]{0,39}`; at most 100 services and 20 environments per service. Services are held in a `Map`, so a name like `constructor` is only a name.
- **An environment needs at least one of `deploy`, `pinned`, `runtime`, `health` and `job`.** A command deploy needs `runtime.kubernetes`. `pinned` is only for an environment with no `deploy`. A pin with `apply: "job"` needs the environment's `job`.
- **`production` has no `deploy` on purpose.** An environment's name is the name jig-core knows it by, and an unknown name counts as production.
- **A health address is https,** at most 500 characters, with no user, password or fragment, and is checked again at every request.
- **A config message never repeats a value,** because it may be shown to the model and a pasted value may be a secret.
- **A `job` belongs to its environment.** The catalog sets its `environment`, and a job that names one is an error.
- **`classify` and `preview` run inside `classifying` and `previewing`:** an `InputError` passes as it is, so jig-core blocks without asking; any other `TypeError` becomes "internal error".
- **The rollout watch spec holds names, never a context or namespace.** Each poll reads the catalog as it is now. It ends `passed` (running), `failed` (a pod that cannot come up) or `timed-out`, a little before the engine's own deadline.
- **Reading every call:** tools read `jig().config.section("ops")` on each call, so a config change applies at once.

## Side Effects

- **Registration:** the `ops` section, three tool declarations and two watch kinds with jig-core; three tools with Pi; a listener for `jig-git:pushed` on Pi's event bus. Nothing is read from a cluster or a CI server until a call.
- **Events:** `announce` wraps `pi.events.emit`; the CI folder publishes `jig-ops:ci-finished` and `jig-ops:artifact-ready` through it.
- **Rollout watch:** each poll is two reads of the cluster through `runtime/kubernetes`. Its state (a poll count) is saved by jig-core as plain JSON.
- **No disk, no env vars, no network in these four files.** `catalogOf` keeps a `WeakMap` cache.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-ops/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

# jig-ops runtime

## Overview

The `runtime` tool: five actions that read a service's state in the environment the ops catalog names: `pods`, `rollout`, `logs`, `events` and `health`. Every action is a read.

This folder holds the tool, its checked input and the address-based health check; the Kubernetes code is in the child folder.

- **Read with:** [README](../../README.md), [Runtime detail](../../docs/runtime.md), [code map](../../docs/code-map.md).

## Interface

- **Tool** (`tool.ts`): `createRuntimeTool(options?)` returns `RuntimeTool` with `definition` (name `runtime`) and `classify(input)`. `RuntimeOptions` is `now`, `sleep`, `fetch` and `healthTimeoutMs`, all for tests. `classify` returns `{ action, environment, effect: "read" }`.
- **Input** (`params.ts`): `parameters` (TypeBox, `additionalProperties: false`), `parseCall(input, catalog)`, `usage(action)`, `ACTIONS`, `Action`, `Call`, `HealthHow` (a `url` or a `pod`), `DEFAULT_TAIL` 200, `MAX_TAIL` 2000, `MAX_SINCE_SECONDS` 86400, `DEFAULT_WAIT_SECONDS` 300, `MAX_WAIT_SECONDS` 600. No I/O.
- **Health by address** (`health.ts`): `urlHealth(address, cancel, deps)`, `HealthDeps`, `HEALTH_TIMEOUT_MS` 10000, `BODY_BYTES` 4096, `shownAddress`.
- **Child:** [`kubernetes/`](./kubernetes/EGM.md): kubectl runner, target config, pods, rollout verdict, wait, logs, events and the in-pod check.

## Invariants

- **Every action reads.** The tool says where a call acts (the catalog's environment, which is also the name `jig-core` knows it by) and that it is a read. A production read is allowed and `jig-core` masks it, so `masksOwnResults` stays unset.
- **`classify` reads the catalog on purpose.** It maps service and environment to a target and refuses curl in a pod in production before anyone is asked. Do not make it pure: see [Catalog](../../docs/catalog.md).
- **Health in a production pod is refused.** An environment `jig-core` counts as production (an unknown name included) must give a `health` address. `execute` checks again, so the tool holds without `jig-core`.
- **`parseCall` refuses a parameter the action does not take,** and a missing one, with the usage line. `timeoutSec` needs `waitFor`; `waitFor` is an image tag; `pod` and `container` are DNS names; numbers are whole and bounded.
- **The model gives no path, header or body to a health check.** The address is the catalog's, a GET, redirects never followed, ten seconds, only the first 4096 bytes read, terminal sequences removed. A non-2xx status is a result, not an error.
- **Health errors use this plugin's words,** never Node's, which can quote the address. A query string is shown as `?…`. Certificate checks are never turned off.
- **`urlHealth` checks `healthProblem` again** for every request: https only, no user or password, no fragment.

## Side Effects

- **Network:** one GET to the catalog's https health address through `fetch`, with `redirect: "manual"` and a 10 s timer.
- **Processes:** kubectl, through the child folder.
- **jig-core:** reads `config.section("ops")` on every call, `environments.kindOf` only for a `health` call that would run curl in a pod (`tool.ts:76-78`; every other call returns before it), and `addFacts` after each action.
- **Timers:** a health timeout and a wait sleep that ends early when the call is stopped. No disk, no env vars, no module state.

## Verification

- Run from the repo root: `node --import ./test/support/host.mjs --test "plugins/jig-ops/test/*.test.ts"`
- Integration (real services, skipped when unset): `npm run test:it`
- Docs: `node scripts/check-docs.mjs`

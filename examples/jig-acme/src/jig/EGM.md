# jig (handle copies)

## Overview

How jig-acme reaches `jig-core` without importing it. Pi gives each package its own module root, so a company plugin cannot import `jig-core` modules. It keeps a copy of the global-handle lookup and of the port helpers, and re-exports the contract's types only. A test fails when a copy drifts from Jig's.

## Interface

- **`client.ts`**, a copy of `plugins/jig-core/src/client.ts`:
  - `jig(): JigApi`: the API on the process-wide symbol `Symbol.for("jig.core.api/v1")`; throws when `jig-core` is not loaded.
  - `withJig(use: (api: JigApi) => void): void`: runs `use` now, or queues it on `Symbol.for("jig.core.pending/v1")` until `jig-core` loads.
  - `publishJig(api): unknown[]` and `withdrawJig(api): void`: for `jig-core` only, kept so the copy stays identical.
- **`ports.ts`**, a copy of `plugins/jig-core/src/kit/ports.ts` (imports only `node:net`):
  - `portAccepts(port, timeoutMs?)`, `socksAnswers(port, timeoutMs?)`: never reject.
  - `freePort(options?: FreePortOptions): Promise<number>`.
  - `waitForPort(port, options: WaitOptions): Promise<void>`: rejects with `PortWaitError` (`reason` `"timeout"` or `"cancelled"`).
  - Types `FreePortOptions`, `WaitOptions`, and class `PortWaitError`.
- **`types.ts`**: `export type * from "../../../../plugins/jig-core/src/contract.ts"`. Types only; erased at run time.
- Used by `../index.ts` (`withJig`), `../tunnel.ts` (port helpers) and every `register*` file (types).

## Invariants

- **Copies stay identical.** `client.ts` differs from Jig's only in its header and its import; `ports.ts` must equal `kit/ports.ts`. `test/client.test.ts` compares them; to change one, change Jig's file and copy it here, never the reverse.
- **Public contract only.** Nothing here imports a Jig module at run time. `types.ts` is the only place that reaches into Jig's source, with a type-only re-export.
- **Company copy of `types.ts`.** Outside this repository the path points at a checkout of Jig (a `.jig` folder); see [Writing a company plugin](../../../../docs/company-plugin.md#test-it-the-way-jig-acme-does).
- **`ports.ts` has no state** and talks only to `127.0.0.1`.

## Side Effects

- `client.ts`: reads and writes the two process-wide symbols on `globalThis`; no I/O.
- `ports.ts`: opens and closes TCP sockets on `127.0.0.1`; `freePort` briefly listens on port 0; timers for polling and sleeps.

## Verification

- Run: `node --import ./test/support/host.mjs --test "examples/jig-acme/test/*.test.ts"` from the repo root (`client.test.ts` is the copy check).
- Whole suite: `npm test`.

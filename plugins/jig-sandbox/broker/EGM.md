# jig-sandbox/broker

## Overview

`broker.mjs` is a plain-JavaScript child process and the only place Anthropic's sandbox runtime
(`SandboxManager` from `@anthropic-ai/sandbox-runtime`) runs. `../src/broker-client.ts` starts one per Pi session with
`child_process.fork` (Pi's own Node, no loader options, a short environment, the session's private folder as working
folder) and talks to it over the IPC pipe. Pi asks it to wrap a command, then spawns the wrapped command itself in the
project, so streaming, time limits and cancelling stay Pi's. Design: [design](../docs/design.md); file roles:
[code map](../docs/code-map.md). Plugin: [jig-sandbox](../README.md).

## Interface

- **Files.** `broker.mjs` only. It has no exports; its interface is the pipe protocol. It is JavaScript, not TypeScript, on
  purpose: a plain `node` child cannot strip types from files under `node_modules`, where Pi installs packages.
- **Request** `{ id, type, ...fields }`; **answer** `{ id, ok: true, result }` or `{ id, ok: false, error }`. A message with
  no `id` is an event.
- **Request types** (the `handlers` table; an unknown type is an error answer):
  - `hello` returns `{ pid, cwd, node }`.
  - `init { config, askHosts }` initializes the runtime (resetting a previous one) and returns `{ warnings }`.
  - `wrap { command, commandId, commandText?, customConfig }` returns `{ wrapped }`, a shell string Pi spawns.
  - `finish { commandId }` returns `{ violations: [{ line }] }`, the runtime's recorded network refusals for that command.
  - `answer-host { askId, allow, reason }` is Pi's reply to a host question.
  - `reset` resets the runtime and refuses every pending host question.
- **Events from the broker:** `{ event: "ready" }` once at start, and `{ event: "ask-host", askId, host, port }`.

## Invariants

- **Fail closed on hosts.** In `init` with `askHosts: true`, the runtime must report `askCallbackDenyReason === true`; if not,
  `init` throws, because releases before 0.0.78 read any answer that is not `false` as a yes. Only `allow === true` allows;
  a closed pipe, a missing answer or a reset is a refusal with a reason.
- **Questions time out** after `ASK_TIMEOUT_MS` (10 minutes), and the connection is refused. `reset` resolves all waiting
  questions as refused.
- **No credentials here.** Pi starts the broker with a short environment; nothing in the protocol carries a secret.
- **Placeholder files stay out of the project.** The runtime puts empty placeholder files (`.bashrc`, `.gitconfig`,
  `.vscode`, ...) into its working folder, which is the session's private folder, so `git add -A` cannot commit them.
  They are cleaned (`cleanupAfterCommand`) only when no wrapped command is in flight (`inFlight` counts wrap minus finish).
- **A fault stays contained.** A runtime error or hang makes Pi restart the broker and refuse the command. An uncaught
  exception or unhandled rejection writes the stack to stderr and calls `shutdown(1)`; the runtime's SIGINT and SIGTERM
  handlers that keep a process alive are harmless here, and would not be in Pi.
- **Leaving is bounded.** `disconnect` (Pi closed the pipe) calls `shutdown(0)`: reset the runtime, then exit; a
  `SHUTDOWN_GRACE_MS` (3 s) unref'd timer exits anyway. `shutdown` runs once.
- **Handler lookup uses `Object.hasOwn`,** so a request type such as `constructor` is unknown, not a call.
- **Keep it plain JavaScript** and keep the protocol one JSON message each way. A change to a request type changes
  `../src/broker-client.ts`, `../src/sandbox.ts` and [design](../docs/design.md) in the same commit.

## Side Effects

- **Runs the sandbox runtime:** bubblewrap on Linux (Seatbelt on macOS), the runtime's HTTP and SOCKS proxy for `filtered`
  and `ask`, and `checkDependencies` warnings.
- **Disk.** The runtime writes placeholder files into the broker's working folder (the session's private folder) until
  cleanup or reset.
- **IPC.** `process.send` and `process.on("message")` only; no sockets of its own and no network calls.
- **Process.** Installs `disconnect`, `uncaughtException` and `unhandledRejection` handlers; calls `process.exit`; writes
  stack traces to stderr.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/broker.test.ts"`
- Needs `bwrap`, `socat`, `rg` and `python3` for the real-sandbox tests; they skip with a reason when missing (they fail in CI, where `CI` is set).
- Docs: `node scripts/check-docs.mjs`

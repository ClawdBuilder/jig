# jig-sandbox/src/network

## Overview

The network side of `jig-sandbox`. In `filtered` and `ask` modes the sandbox's proxy asks a callback about every
connection; this folder holds that callback's policy (allow, refuse with a reason, or ask you), the address and host
classification behind it, the host question with its remembered answers, and the localhost bridge that carries task and
listed ports into each command's private network. In `open` and `off` the callback does not run, so `network.deny` does
nothing there. Modes: [Network](../../docs/network.md); design: [design](../../docs/design.md); file roles:
[code map](../../docs/code-map.md). Parent: [src](../EGM.md).

## Interface

- **`addresses.ts`**: `classifyHost(host, own?)` returns `{ kind: "ip", address, range }`, `{ kind: "name", name, metadata,
  localhost }` or `{ kind: "invalid" }`. `Range` is `metadata`, `loopback`, `own`, `link-local`, `private`, `carrier`,
  `unspecified`, `multicast` or `reserved` (`undefined` means public). Also `rangeOf`, `parseIPv4`, `parseIPv6`,
  `canonicalAddress`, `ownAddresses`, `cleanHost`. It classifies; it never decides.
- **`hosts.ts`**: `parsePattern(text)`, `HostPattern`, `entryFor(host, port)`, `matchesHost`, `firstMatch(patterns, host, port)`,
  `hostPort`. Patterns are `api.example.com`, `*.example.com`, an optional `:port`, bracketed IPv6.
- **`policy.ts`**: `createPolicy(deps: PolicyDeps): Policy` with `decide(host, port): Promise<Decision>` and
  `judge(host, port): Decision | "ask"`. `Decision` is `{ allow: true }` or `{ allow: false, reason }`.
- **`ask-host.ts`**: `createHostAsker(deps): HostAsker` with `ask(host, port)` and `allowed()`; `Screen`, `ONCE_MS` (15 s).
- **`bridge.ts`**: class `Bridge(deps: BridgeDeps)` with `active`, `problem`, `taskStarted`, `taskEnded`, `serves(port)`,
  `forwarderPorts()`, `sync()`, `preamble()`, `close()`; `realProcesses`, `listeningPorts`, `pythonEnter`, `CANNOT_ENTER` (111).
- **`wiring.ts`**: `wireNetwork(deps: SandboxDeps, view: SandboxView)` returns `{ hostAsker, bridge, policy }`, so `Sandbox` does not hold the wiring.

## Invariants

- **Decision order in `judge()` is fixed:** a port outside 1..65535 is refused; an invalid host is refused; a metadata name
  or address is refused; a `network.deny` match is refused and names the entry; loopback or own addresses pass only when the
  port is in `network.localhost` (loopback also when the bridge serves it); any other blocked range is refused with its own
  reason; `filtered` then allows everything else; `ask` allows a `network.allow` match or a kept answer, else asks you.
- **Blocked ranges are refused before the allow list is read,** so `network.allow` can never open a private, link-local or
  carrier address. Metadata addresses are always blocked (`169.254.169.254`, `169.254.170.2`, `100.100.100.200`,
  `fd00:ec2::254`) as are the cloud metadata names.
- **`decide()` never throws:** an exception is a refusal, and no screen or no answer is a refusal.
- **Odd spellings fail closed.** `2130706433`, `0x7f000001` and `127.1` are `invalid` and refused, as are IPv6 zones,
  unparsable literals and names over 253 characters. IPv6 forms that wrap an IPv4 address (`::ffff:a.b.c.d`, NAT64, 6to4) are
  judged by the embedded address. A literal equal to one of this machine's own addresses is range `own`.
- **`localhost` and `*.localhost` are loopback,** refused unless the port is listed or bridged. A `jig-core` tunnel port
  is therefore unreachable unless listed in `network.localhost`.
- **Patterns.** `*.example.com` covers subdomains, not `example.com`; no port means every port; an unparsable pattern is skipped.
- **The ask prompt offers exactly** Once, This session, Always, No. The prompt times out after 120 s (refused); Once lasts
  15 s; no screen is no, pointing at `/sandbox allowed add <host>`. Concurrent questions for one `host:port` share one
  promise, run inside `jig-core`'s approval queue, and re-check the allowed list when their turn comes.
- **The bridge works only on Linux** in `filtered` or `ask`. The runtime's relays (ports 3128 and 1080) are never bridged
  as a task's server. At most 16 forwarder ports; a port is dropped after 2 scans without it; a busy port is retried after 10 s.
- **Only TCP LISTEN sockets** on loopback or the wildcard are bridgeable (`0.0.0.0` dials `127.0.0.1`, `::` dials `::1`).
  A port is allowed through only while one of the bridge's own listeners is ready on it.
- **The helper is hardened:** `pythonEnter` refuses pid 1 or less and a bad port, runs `python -I -S -c` with `PATH=/usr/bin:/bin`
  only, and exits 111 when `setns` fails, which sets `problem`. Without `python3`, `network.localhost` still works.
- **The preamble is one line** (command line numbers do not move), runs in a subshell, waits a bounded loop for forwarders,
  and is empty when there are no ports or no `socat`.

## Side Effects

- **Sockets.** Host listeners on `127.0.0.1:<port>` (and `::1`, best effort) per bridged port. TCP only, no Unix sockets.
- **Reads.** `/proc/<pid>/ns/net`, `/proc/<pid>/net/tcp` and `tcp6`; `os.networkInterfaces()`. A 1 s unref'd poll starts at
  the first task and stops when none is watched. `sync()` runs before a command is wrapped, scans only when the last scan was at
  least 150 ms ago, and may wait up to 1 s for listeners being made. `Sandbox.wrap` skips it for the sandbox's own probe and
  doctor commands.
- **Processes.** One `python3` helper per client connection (`setns` into the task's namespaces, then a 5 s connect and relay).
  Inside each command, the preamble starts one `socat` per port through the runtime's HTTP CONNECT relay on port 3128.
- **Environment.** The preamble reads `CLOUDSDK_PROXY_USERNAME` and `CLOUDSDK_PROXY_PASSWORD`, which the runtime sets; `wiring.ts`
  reads `PATH` to find `python3`. Nothing here sets variables on the sandboxed process.
- **Disk.** An Always answer is kept in `<agentDir>/jig-sandbox/allowed.json` (a file the sandbox cannot write); if the write fails
  it is kept for the session only and you are told. Session and Once answers are in memory.
- **Prompt.** `screen.ui.select` with a 120 s timeout. Refusals travel as the proxy's 403 reason and a `[sandbox] cannot reach host:port` line.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/network*.test.ts"`
- Needs `bwrap`, `socat`, `rg` and `python3` for the real-sandbox tests; they skip with a reason when missing.
- Docs: `node scripts/check-docs.mjs`

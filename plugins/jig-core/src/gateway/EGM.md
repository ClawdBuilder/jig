# jig-core/src/gateway

## Overview

The gateway: an MCP server over standard input and output that offers Jig's tools to an agent that is not Pi. It runs the engine (`../engine.ts`) as a library: for each call it
has the engine judge, runs the tool and writes one record line. Nobody can be asked, so a read runs and every call that would need a question is refused. It serves revision
2026-07-28 through `serveStdio` of `@modelcontextprotocol/server` 2.4.0, and older revisions through the same entry. Specification: [gateway](../../docs/gateway.md); file roles:
[code map](../../docs/code-map.md). Parent: [src](../EGM.md).

## Interface

- **`main.ts`.** `runGateway(argv, env)`: answers `--version` and `--help`, finds the settings folder, loads the connector files, makes the runtime and calls `serveStdio`. Run as
  `node plugins/jig-core/src/gateway/main.ts [--home <folder>]` (`import.meta.main`). The build bundles this same file into `../../dist/jig-gateway.mjs` with `define` `BUILT_GATEWAY: true`, which is how
  the file knows its layout (below); the built file starts itself when node was given it, and exports `runGateway` for `bin/jig-gateway.mjs`. `--help` names the program: `main.ts`, or `jig-gateway` when built.
- **The built gateway.** `scripts/build-gateway.mjs` writes `plugins/jig-core/dist/`: `jig-gateway.mjs` (engine, gateway, MCP SDK and `marked`), `connectors/<name>.mjs` for each entry of `jig.connectors`
  (TypeBox inside), `tools.json` and `theme.css`. The files are committed and shipped; `npm run check` runs `--check`. See [the page](../../docs/gateway.md#the-built-gateway) and `scripts/EGM.md`.
- **`server.ts`.** `createServerFactory(runtime, version)` gives the function `serveStdio` calls to make a server (it may call it more than once in a process); `instructionsOf(runtime)`.
  Each tool is registered with `fromJsonSchema(entry.inputSchema)`, so the SDK checks the input first. A result is one text block, `isError: true` for a refusal or a failure.
- **`runtime.ts`.** `createGatewayRuntime(options): GatewayRuntime` (`entries`, `settingsNote`, `call(name, args, origin)`, `stop()`); `CallOrigin` (agent, call id, cancel signal, optional
  progress), `CallResult` (`text`, `isError`), `RuntimeOptions`; `NO_SCREEN` and `NO_SETTINGS`, the two lines it says.
- **`host.ts`.** `requestHost(shared, agent, cwd)` and `processHost(shared, cwd)` give an `EngineHost`; `clientOf(envelope, fallback?)` the agent a request names; `callIdOf(meta)` the call's id;
  `newCallId()`; `newSessionId()`; `TOOL_USE_ID_KEY` (`claudecode/toolUseId`), `UNKNOWN_AGENT`.
- **`tool-list.ts`.** `describeTool(tool, connector, notOffered?)` gives a `ToolListEntry`; `mcpInputSchema(tool, input, options)` the parameters an agent is shown; `DIR_DESCRIPTION`.
- **`connectors.ts`.** `connectorFiles(packageFile, builtFolder?)` reads `jig.connectors` of a `package.json`: the paths it lists, or, when `builtFolder` is given, `connectors/<name>.mjs` in that folder;
  `isInside(folder, target)` is the test that a path stays in the package; `loadConnector(file)` imports one file by a computed path and checks the shape of its default export (`ConnectorModule`).
- **`jig-tool.ts`.** `jigTool(source): EngineTool` (action `status`), `statusText`, `GatewayOutcome`, `StatusSource`, `STATUS_OUTCOMES` (20).
- The settings folder comes from `../settings-home.ts` (`--home`, then `JIG_HOME`, then the default Jig home when it holds a `jig.json`).

## Invariants

- **Two layouts, said by the build.** From source the connector files are the paths of `jig.connectors`; built they are `connectors/<name>.mjs` beside `jig-gateway.mjs`, for the same names. `main.ts` knows which by
  `BUILT_GATEWAY`, a value only the build sets, and not by a file name. The package's `package.json` is found by `packageFile()` in `../pi-version.ts`, three folders up from the file itself, which is right in both
  layouts because `src/` and `dist/` are as deep as each other. Connector files load at start in both layouts, so there is one code path; `tools.json` is not read by the gateway.
- **The built files import only `node:` modules.** Nothing is installed beside them (Claude Code's install from npm installs no dependency), so the SDK and `marked` are inside `jig-gateway.mjs` and TypeBox, which stays a
  peer dependency of the package, is inside each connector file. `@earendil-works/*` is external in the build, so a Pi import would stay visible as a bare import, and `test/gateway-build.test.ts` fails on one.
- **Only this folder imports an MCP library, and no file of it reaches Pi.** `test/engine-boundary.test.ts` checks both. jig-core names no plugin in an import: the connectors are the files
  listed in `package.json` under `jig.connectors`, and `connectors.ts` loads one by a computed path.
- **Standard output is the protocol's.** Nothing here, and nothing in the engine or a connector it runs, writes to it; a notice goes to standard error (`host.notify`, `main.ts`).
  `test/gateway-process.test.ts` fails when the child writes a line to standard output that is not a JSON-RPC message.
- **Nothing with an effect happens at start or when tools are listed**, but loading the connector files, which only describes their tools. The first call, in this order: create the engine and
  publish its API (`publishJig`), let each connector `register`, declare every tool, `engine.start` (which reads `jig.json` with the sections that were registered, so a section nobody registered
  counts as off), `engine.beginSession`, once. `beginSession` runs with `skipUpdateCheck`: the notice would reach nobody. A start that fails refuses every call, the same way, and runs no tool.
- **Nobody can be asked.** The host has `canAsk` and `canAskProtected` false, `ask` closes the question, `notify` writes one line to standard error and returns false, `wake` returns false,
  `enforcedBy` is `gateway`. A call that needs a question is refused with the engine's own line: `Blocked by jig-core: this call needs approval and there is no screen to ask on.` Rules in
  `jig.json` still apply, so a rule that allows a write lets it run.
- **A refusal is a normal result with `isError: true`,** and the call is finished through `engine.finish`, so it has its record line. A refusal before `judge` (a tool the gateway does not have,
  an action the connector keeps back, a `dir` that is not a folder) has a line with `outcome: "error"`, `errorKind: "not-run"` and no decision.
- **An action the connector keeps back is refused twice.** It is out of the `action` list of the form (and out of the lines of its description that name it), so the SDK rejects it, and the call
  flow refuses a call that names one anyway, before `judge`. A connector lists such an action when the engine would run it with no question (a local write).
- **`dir`.** A tool with `usesFolder` has one more optional text, `dir`, in the form. The gateway takes it out of the input; the engine and the tool never see it. It must be an absolute path to a
  folder that exists, or the call is refused before `judge`. Without it the folder is the one the gateway was started in.
- **The agent's name is for the record only.** It comes from the request's `_meta` envelope (an older revision: from `initialize`), is kept by `agentNameOf` (lower-cased, 1 to 40 of `a-z0-9._-`, else
  `unknown`) and no decision depends on it. The call id is `_meta["claudecode/toolUseId"]` when it is 1 to 200 of `A-Za-z0-9_.:-` (any program can send any text, and the id is in every record line), else a random one; a call that arrives
  under an id another call of this process still holds open gets a random id too, so that both run and both have their record line. One random session id serves the process.
- **A call the SDK's own check rejects leaves no record.** An unknown action, a property the form does not have and an unknown tool name are answered by the SDK before the handler runs, so the
  call never reaches the engine. (Pi writes a `not-run` line for these.) It is accepted for this phase.
- **Hook lines and gateway lines show as two sessions** of one agent until the hook exists and hands over the agent's own session id: the gateway has none, and makes its own.
- **`structuredContent` is not sent.** The result's text is what `engine.run` returned after it cleaned it; the tool's `data` stays in Jig.
- **Calls to a tool with `sequential` run one at a time,** judging and running together, in one chain for all such tools.
- **`jig` is a local read.** `status` lists the last twenty outcomes of this process (kept in memory: time, tool, action, the decision or the refusal line), one line for each problem in `jig.json` (the key
  and the message, never the path) with a pointer to `jig doctor`, a line when no settings folder was found or it has no `jig.json`, and a line for a connector that did not load. It is recorded like any call.
- **When standard input ends** the engine's session ends and the process exits with code 0. Requests still in flight are aborted by the SDK and not answered.

## Side Effects

- **Standard input and output:** the MCP stream. **Standard error:** notices, the SDK's out-of-band errors (`mcp: ...`), a connector that could not be loaded, an engine that could not start.
- **Disk.** Records, spill files and previews in the state folder (the engine's); reads `jig.json` and `package.json`; loads the connector files.
- **Processes and network:** none of its own. A connector's tools run programs and call services as they do in Pi (`pr` runs `gh` or `glab`).
- **Globals.** `publishJig` at the first call, `withdrawJig` at `stop` (and on a failed start).
- **Environment read:** `JIG_HOME` (`../settings-home.ts`), `JIG_PARENT_SESSION` and `JIG_AGENT_ROLE` (`host.ts`), and the engine's own (`JIG_STATE_DIR`, `HOME`).

## Verification

- `npm run test:engine` runs `plugins/jig-core/test/engine/gateway-*.test.ts` with no Pi: the tool list, the host, the call flow (over `gateway-harness.ts`), the settings folder and the MCP side
  over a linked in-memory pair.
- `node --import ./test/support/host.mjs --test plugins/jig-core/test/gateway-process.test.ts` starts the gateway as a child with `test/support/refuse-pi.mjs` and speaks revision 2026-07-28 to it, from source and from the built file.
- `node --import ./test/support/host.mjs --test plugins/jig-core/test/gateway-build.test.ts` shows the committed files are what the build writes, import only Node's modules and name no machine, that `tools.json` equals the answer
  to `tools/list`, and that a copy with nothing installed runs. After a change to this folder, a connector or a bundled dependency: `npm run build:gateway`, and commit `plugins/jig-core/dist/`.
- By hand: `(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"t","version":"0"}}}}'; sleep 1) | node plugins/jig-core/src/gateway/main.ts`
  prints one line whose `result.supportedVersions` is `["2026-07-28"]`. The `sleep` keeps standard input open: the SDK aborts requests that are still in flight when input ends.

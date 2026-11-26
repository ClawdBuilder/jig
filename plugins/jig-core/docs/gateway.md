# The gateway

The gateway is an MCP server over standard input and output. It offers Jig's tools to an agent that is not Pi, and runs every call through the same engine Pi uses: Jig classifies the call, decides, runs the tool and writes one record. Back to the [jig-core overview](../README.md).

It runs from a checkout of the repository, as the command `jig-gateway` of the npm package, or as a Claude Code plugin ([Use it in Claude Code](#use-it-in-claude-code)).

## Start it

An agent starts it from its MCP configuration, in one of three ways that run the same code:

```bash
jig-gateway [--home <folder>]
node <package>/plugins/jig-core/dist/jig-gateway.mjs [--home <folder>]
node plugins/jig-core/src/gateway/main.ts [--home <folder>]
```

The command and the built file need nothing installed beside them ([the built gateway](#the-built-gateway)). The last form runs the sources from a checkout.

- **Revision.** It serves MCP revision 2026-07-28, and older ones, through the official SDK (`@modelcontextprotocol/server`).
- **Start.** It reads the connector files that `package.json` lists (`jig.connectors`) to describe their tools. It opens no port, writes no file and reads no `jig.json` until the first call.
- **End.** When the agent closes standard input, the gateway ends its session and exits with code 0.
- **Output.** Standard output is the protocol's. Every notice goes to standard error.
- **Words.** `--version` prints the version of the package, and `--help` says how it is started.

## Use it in Claude Code

The package root is a Claude Code plugin: `.claude-plugin/plugin.json` starts the built gateway, and `.claude-plugin/marketplace.json` lists it as the plugin `jig` of the marketplace `clawdbuilder`. It needs Claude Code 2.1.326 or later, and was run on 2.1.332. Two commands in a terminal add the marketplace and install the plugin:

```bash
claude plugin marketplace add <folder of the Jig package>   # or: ClawdBuilder/jig, from GitHub
claude plugin install jig@clawdbuilder --config jig_home=<folder that holds jig.json>
```

- **The marketplace.** A folder is read in place, so a Jig installed with `pi install` and the plugin can run one copy. The GitHub name makes Claude Code keep its own copy of the repository.
- **`jig_home`** is the folder that holds your `jig.json`, and the one value the plugin asks for. Leave it out and the gateway looks where [it finds jig.json](#how-it-finds-jigjson): the default Jig home, or none and the built-in defaults. `jig doctor` names the folder to give in its "Settings folder for other agents" line.

What you then have:

- **Three tools,** `pr`, `release` and `jig`, which Claude Code shows as `mcp__plugin_jig_jig__pr`, `mcp__plugin_jig_jig__release` and `mcp__plugin_jig_jig__jig`, and one skill, `jig:git`, that says how to use them.
- **Reads run, and writes are refused** with the line under [What it refuses](#what-it-refuses), because Jig cannot ask you from there.
- **Four programs in Claude Code's shell.** Claude Code puts a plugin's `bin/` folder at the end of the `PATH` of its shell tool, and the package root is the plugin. So `jig.mjs`, `jig-gateway.mjs`, `clipboard-copy` and Jig's optional launcher `pi` can be run there by name. They come after your own `PATH` entries, so a command of yours with the same name still wins, and Claude Code's own permission rules apply to running them. The plugin has no way to switch this off.
- **Claude Code asks first.** It asks before each Jig tool unless you allow `mcp__plugin_jig_jig__*` in its own permissions (`permissions.allow`). Jig never adds that rule for you.
- **Every call is recorded.** The line has `agentName` `claude-code` and `enforcedBy` `gateway`, and `jig lens` lists the last twenty ([Records](records.md)).
- **`jig doctor` checks it** in its "Other agents" group: that the gateway starts, which folder to give, Claude Code's version, and whether the marketplace and the plugin are there, each with the command that is next ([Setup and doctor](../../../docs/setup-and-doctor.md#what-it-looks-at)).

To remove it:

```bash
claude plugin uninstall jig@clawdbuilder
claude plugin marketplace remove clawdbuilder
```

**What this version does not do.** It adds no approval question and no shell guard in Claude Code: those come later. Claude Code's own shell and file tools are not under Jig's rules, and a write is judged by Jig only when Claude Code calls Jig's tool for it. So the plugin is for reading pull requests and releases.

## The built gateway

`npm run build:gateway` writes the gateway as plain JavaScript into `plugins/jig-core/dist/`. The files are committed and shipped in the package.

| File | What it is |
|---|---|
| `jig-gateway.mjs` | The engine, the gateway, the MCP SDK and `marked`, in one file |
| `connectors/<name>.mjs` | One file for each plugin in `jig.connectors`, with TypeBox inside |
| `tools.json` | The tools as the built gateway lists them, and each tool's connector |
| `theme.css` | A copy of `src/kit/theme.css`, which the preview pages read beside the bundle |

- **Nothing to install.** The files import only Node's own modules, so a copy unpacked from npm runs with no `node_modules`. A test reads every import and fails on any other.
- **Two layouts.** From source the connector files are the paths in `jig.connectors`. Built, they are `connectors/<name>.mjs` beside the gateway, for the same names. The build tells the file which one it is in.
- **One `package.json`.** Both `plugins/jig-core/src/` and `plugins/jig-core/dist/` are three folders below it, so the gateway finds its version and its connector list the same way in both.
- **`tools.json` is for review.** It shows what a model is told, and a test keeps it equal to the answer to `tools/list`. The gateway does not read it: it loads its connector files at start and takes the tools from them.
- **When to rebuild.** After a change to the gateway's code, a connector or a bundled dependency, run `npm run build:gateway` and commit `dist/`. `npm run check` fails with that command when the files are stale. Two builds give the same bytes.
- **The command.** `jig-gateway` is `bin/jig-gateway.mjs`, plain JavaScript that loads the built file. With no built file it says so in one line on standard error and exits with code 1.

## How it is checked

CI checks the gateway the way a person gets it, and the plugin through Claude Code itself:

- **`npm run check:gateway`** packs the package, installs it with no Pi anywhere, starts `jig-gateway` and asks for its tools, a read and a refused write. It runs on Node 22.19.0 and 26 on Linux, and as an advisory job on macOS and Windows.
- **`npm run check:claude`** has Claude Code, at the version in `package.json`'s `jig.agents`, validate the plugin, add the marketplace, install the plugin and start its server. It needs no sign-in and no model.
- **A weekly canary** runs the second check on the newest Claude Code ([Compatibility](../../../docs/compatibility.md#tested-with)).

## What it offers

| Tool | What an agent can do | Where it comes from |
|---|---|---|
| `pr` | `view`, `list` and `comments` run; the writes are refused | jig-git, `src/connector.ts` |
| `release` | `tags` and `releases` run; the writes are refused | jig-git, `src/connector.ts` |
| `jig` | `status`: what the gateway decided lately, and what is wrong with the settings | jig-core |

- **Kept back.** `pr watch` and `release tag_create` are not offered. Both write only on this machine, so the engine would run them with no question. They are not in the form an agent sees, and a call that names one is refused.
- **`dir`.** `pr` and `release` work on a repository, so each has one more optional parameter, `dir`: the folder the agent works in, as an absolute path. Without it the folder is the one the gateway was started in.

## How it finds jig.json

The first of these that gives a folder wins:

1. an argument `--home <folder>`;
2. the variable `JIG_HOME`;
3. the default Jig home, `~/.jig`, but only when it holds a `jig.json`.

An empty value counts as not set, because Claude Code passes an empty string for a value nobody set. With no folder, the gateway still starts and runs on the built-in defaults. It says so in its instructions and in `jig` `status`.

## What it refuses

Nobody can be asked, so the gateway has no screen. A read runs. A call that would need a question is refused with the line Jig uses everywhere there is no screen:

```text
Blocked by jig-core: this call needs approval and there is no screen to ask on.
```

- **Rules still apply.** A rule in `jig.json` that allows a call needs no question, so the call runs. A rule that denies it refuses it.
- **Other refusals.** A tool the gateway does not have, an action it keeps back, and a `dir` that is not an absolute path to a folder that exists are refused before the engine decides, each with one plain line.
- **The shape of a refusal.** It is a normal tool result with `isError` set and the line as its text, not a protocol error.
- **Results.** A result is the text Jig returned after it redacted, masked and capped it. `structuredContent` is not sent.

## What it records

Every call that reaches the engine, and every refusal the gateway makes itself, writes one line to the [records](records.md). The line has `agentName`, the name the agent sent, and `enforcedBy: "gateway"`.

- **The call id** is the one Claude Code sends in the request (`claudecode/toolUseId`), or a new one when the request has none.
- **The session** is one random id for the life of the process. An agent's own hook will have another, so the lines of the hook and of the gateway show as two sessions until the hook hands over its id.
- **Not recorded.** A call that the SDK itself rejects, because its action or a property is not in the form, never reaches the engine and leaves no line.

## The jig tool

`jig` with the action `status` lists the last twenty calls this gateway decided, with the decision or the line that refused the call. It adds one line for each problem found in `jig.json`, with a pointer to `jig doctor`, and says when no settings were found. It is a local read, and it is recorded like any call.

## Connectors

A connector is a plugin's `src/connector.ts`: a default export that hands the plugin's tools, the actions it keeps back and its registration to a host that is not Pi ([Plugin contract](plugin-contract.md)). The package lists them in `package.json`:

```json
{ "jig": { "connectors": { "jig-git": "./plugins/jig-git/src/connector.ts" } } }
```

At the first call the gateway creates the engine, lets each connector register its section of `jig.json`, declares the tools, and only then reads `jig.json`, so a section that a connector registered is checked and a section nobody registered counts as off.

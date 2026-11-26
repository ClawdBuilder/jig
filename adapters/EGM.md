# adapters

## Overview

What Jig ships for an agent that is not Pi, apart from the gateway: files that agent reads. It holds no code. Pi's own part, jig-core's extension, is not here. Today the one folder is `claude-code/`,
which holds the skill that rides in the Claude Code plugin. The plugin's two files sit in `.claude-plugin/` at the package root, because Claude Code reads the package root as the plugin. In the
glossary, what joins an agent to the engine is an "agent adapter": this folder and `.claude-plugin/` are the Claude Code one. Specification: [Gateway](../plugins/jig-core/docs/gateway.md#use-it-in-claude-code).
Parent: [root](../EGM.md).

## Interface

- **`claude-code/skills/git/SKILL.md`**: the skill `git` (Claude Code shows it as `jig:git`). It teaches a model Jig's `pr`, `release` and `jig` tools: which actions read, that a write is refused in this version,
  and what to do then. It is the only copy of the skill for another agent; the shared source folder comes with the second agent.
- **`../.claude-plugin/plugin.json`**: the plugin `jig`: `version` (the package's), `description`, `author`, `userConfig.jig_home` (a directory, not required), the MCP server `jig` written inline under `mcpServers`
  (`node` and `${CLAUDE_PLUGIN_ROOT}/plugins/jig-core/dist/jig-gateway.mjs`, with `JIG_HOME` from `${user_config.jig_home}`), and `skills` (`./adapters/claude-code/skills`).
- **`../.claude-plugin/marketplace.json`**: the marketplace `clawdbuilder`, owned by Jig Contributors, with one plugin, `jig`, whose `source` is `./` (the package root) and whose `version` is the package's.

## Invariants

- **The package root is the plugin.** Both files are at the root, and `package.json` `files` names `adapters/**` and `.claude-plugin/**`, so `npm pack` carries the dot folder. A copy of the package from npm, from a folder or from git works.
- **Both versions equal `package.json`'s.** `scripts/release.mjs` writes them and `scripts/check-version-pins.mjs` fails when they differ. They are never edited by hand.
- **The plugin holds no program, no hook, no command and no `.mcp.json`.** Its one server starts the built gateway by a path inside the plugin, so nothing has to be on the path and nothing is installed beside it. This
  version adds no approval question and no shell guard in Claude Code; hooks come with a later part.
- **An empty `jig_home` counts as not set.** Claude Code passes an empty `JIG_HOME` for a value nobody gave, and the gateway then looks in the default home, else uses built-in defaults ([Gateway](../plugins/jig-core/docs/gateway.md#how-it-finds-jigjson)).
- **The names are pinned.** The plugin `jig`, the marketplace `clawdbuilder`, the server `jig` (so the tools are `mcp__plugin_jig_jig__*`) and `jig_home` are public ([Compatibility](../docs/compatibility.md)); `doctor-agents.ts` reads the same names.
- **The skill is read by a model in an agent that is not Pi, so every sentence of it is true there.** It says "Jig's `pr` tool", never a full tool name, which differs by agent; it names no Pi tool (`git`) and no action the
  gateway keeps back (`watch`, `tag_create`); and it lists only actions that `plugins/jig-core/dist/tools.json` lists, all of them. A skill teaches and never enforces. When the gateway's actions change, change the skill.
- **No company names, hostnames or machine paths** in any file here.

## Side Effects

- None at run time: nothing here is code. Claude Code reads the plugin files, copies the package into its own cache when it installs from GitHub or npm, and starts the built gateway from the plugin's folder.
- `jig doctor` only reads what these files name, through `claude`'s own list commands ([Setup and doctor](../docs/setup-and-doctor.md#what-it-looks-at)).

## Verification

- `node --import ./test/support/host.mjs --test plugins/jig-core/test/adapters-claude-code.test.ts`: the two files field by field, and the skill against `tools.json`.
- `node --import ./test/support/host.mjs --test test/package.test.ts`: the tarball carries both files and the skill, and no `EGM.md`.
- `node scripts/check-version-pins.mjs`: the two versions equal `package.json`'s.
- By hand, in a throwaway Claude Code settings folder (`CLAUDE_CONFIG_DIR`): `claude plugin validate .`, `claude plugin marketplace add <this package's folder>`, then `claude plugin install jig@clawdbuilder`.

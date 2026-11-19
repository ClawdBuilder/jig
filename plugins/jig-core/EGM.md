# jig-core

## Overview

The tool manager every other Jig plugin needs. It sits over every tool call through Pi's hooks, whoever wrote the tool: it
classifies where the call acts and whether it reads or writes, decides allow, ask or deny from the rules and the floor, asks
you inside the waiting call, then redacts, masks, caps and records the result. It also holds `jig.json`, secrets, sign-in and
transports, the watch engine, the setup questions, the `jig` command for the Jig home and the kit that other plugins import. Specification:
[README](./README.md); file roles and one call followed through them: [code map](./docs/code-map.md).

## Interface

- **Entry.** `index.ts` re-exports the default factory of `src/index.ts` (so Pi labels the extension by the plugin's folder).
  It loads first: `package.json` lists it before every other plugin. Contract of the code: [src](./src/EGM.md).
- **The only code other plugins may import:** `src/contract.ts` (types and `JIG_EVENTS`), `src/client.ts` (`jig()`, `withJig()`)
  and the `.ts` files directly in `src/kit/` ([kit](./src/EGM.md#the-kit)). `test/boundaries.test.ts` fails on any other cross-plugin import.
- **Runtime handle `jig()`** (`Symbol.for("jig.core.api/v1")`), pinned in `test/surface.test.ts`. Members: `version` (1),
  `declareTool`, `tools.declared`, `addFacts`, `approvedPreview`, `markRefused`, `takeRefused`, `setTicket`, `records.recall`,
  `approvals.inTurn`, `gates.register`, `secrets.resolve`, `http.request`, `exec.run`, `exec.git`, `mask.text`, `mask.value`,
  `environments.kindOf|list`, `protectedPaths.list`, `signIn.register|headers`, `transports.register|request`,
  `tunnels.register|open`, `watches.registerKind|start|list|stop`, `sandbox.register|run|canRun`, `status.register`,
  `onboarding.register`, `profiles.register|active`, and `config.addEnvironments|addRules|addClassifyRules|addProtectedPaths|
  addSecretCommands|enableSecretBackends|addMaskFields|registerSection|addSectionDefaults|section`.
- **Pi surface.** Tool `watch` (actions `list`, `stop`); commands `/jig` (`setup`, `doctor`, `rules [tool]`, `records`) and
  `/profile`; the program `jig`, which is Pi for the Jig home (`~/.jig`, or `JIG_HOME`) plus `doctor`, `setup`, `update`, `help`,
  `--version` and Pi's own package commands (`bin/jig.mjs`, code in [cli](./src/cli/EGM.md)).
- **Events on `pi.events`:** jig-core emits `jig:decision` and `jig:watch-done`; `jig:stage-done` is defined in `JIG_EVENTS` but emitted by `jig-workflow`. Watch engine: [watch](./src/watch/EGM.md). Masker: [mask](./src/mask/EGM.md).
- **`jig.json` sections jig-core owns** (a plugin cannot register them): `approvals`, `classify`, `environments`, `protectedPaths`,
  `records`, `rules`, `secrets`, `spill`, `startChecks`, `ui`. It checks five more itself: `tools`, `transports` and `updates`, which a
  company plugin may give defaults for, and `profiles` and `profile`, which it may not.
- **Variables the repository's code reads or sets** (pinned): `JIG_AGENT_ROLE`, `JIG_CONDITION`, `JIG_HOME`, `JIG_LENS_DASHBOARDS`,
  `JIG_LENS_INDEX`, `JIG_OUTER_PI_DIR`, `JIG_PARENT_SESSION`, `JIG_PI_HOST`, `JIG_ROLE_POLICY`, `JIG_STATE_DIR`, `JIG_THEME_FOOTER`.
  jig-core itself reads every one but `JIG_LENS_*` (read by `jig-lens`), `JIG_THEME_FOOTER` (read by `jig-theme`) and `JIG_ROLE_POLICY`
  (defined and parsed in the kit, read by `jig-agents` and `jig-sandbox`).
- **Subdirectories:** [src](./src/EGM.md) (with [cli](./src/cli/EGM.md), [kit](./src/EGM.md#the-kit), [mask](./src/mask/EGM.md),
  [watch](./src/watch/EGM.md)).
- **Not contracts:** `docs/` (the detail pages the README links) and `test/` (unit tests, tests inside a real Pi session with a
  scripted model, and the pinned-surface tests).

## Invariants

- **The public surface is pinned.** Tool and action names, slash commands, `jig.json` sections, `JigApi` members, event names, record
  fields and `JIG_*` variables are literals in `test/surface.test.ts` and `test/plugin-surface.test.ts`. Adding is fine: add the name to
  the test. Removing or renaming needs a [Decisions](../../docs/decisions.md) entry first and a contract break a new `version`
  ([Compatibility](../../docs/compatibility.md)). Never loosen a pin to get green.
- **The audit pins each action.** `test/audit.test.ts` checks every action of every tool: a row in its plugin's README or docs with the
  effect and approval `classify` gives it, a line in the test's `TABLE`, a test naming it as `action: "<name>"`, and for a tool that sets
  `masksOwnResults` a test that says masking. A new action changes the docs and `TABLE` in the same commit.
- **The floor is not configurable** ([Permissions](../../docs/permissions.md)): production writes are denied, production results are
  masked, credentials are hidden from `bash`, nothing that needs approval runs without a screen, Pi's file tools refuse protected paths and
  ask for a write outside the working folder unless the person allowed it, and a tool that declares `always: "ask"` asks on every call.
- **A failure blocks the call** ("jig-core could not decide: ..."); a plugin's gate only tightens; unknown tools ask.
- **Approvals happen only inside the waiting tool call.** No endpoint in this plugin approves.
- **No sign-in and no stored credential.** A request's credential is read from a source the user configured, attached by
  `jig().http.request` and scrubbed from the reply; the plugin never signs in ([Decisions](../../docs/decisions.md)). The one
  exception is a library that must hold the secret in-process (a database driver, an SSH tunnel), which gets it from
  `jig().secrets.resolve` for that connection only ([the exception](../../docs/decisions.md#2026-11-17-a-library-that-must-hold-a-credential-gets-it-from-the-resolver)).
- **An unknown configuration field is an error** that names the file and the key; the plugin then starts with defaults rather than guessing.
- **The README is the specification.** Code follows it and when either changes the other changes in the same commit.
  `test/code-maps.test.ts` fails when `src/` and [code map](./docs/code-map.md) disagree. A source file over 500 lines is a ratchet
  (`plugins/jig-core/test/file-sizes.test.ts`): a new file may not cross 500, and a listed one may not grow.
- **Generic only:** no company names, hostnames or secret-shaped literals (`test/no-secret-literals.test.ts`).

## Side Effects

- **State folder** `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`: records, spill files, previews, skill overlays,
  watches, the daily mask key, the doctor report and two small caches (`update-check.json`, `doctor-release.json`), private (0700 folders,
  0600 files). Details: [src](./src/EGM.md).
- **Configuration file** `<agentDir>/jig.json`: the Jig home (`~/.jig`, or `JIG_HOME`) for `jig`, else Pi's agent folder
  (`PI_CODING_AGENT_DIR` or `~/.pi/agent`). Written only by setup (`jig setup`, and `/jig setup` in a TUI, in the session's own agent folder: a Jig home or an
  ordinary Pi folder), through `setup-write.ts`: after a confirm, with a backup when the file already exists, and a restore of that backup
  when the result is not ok.
- **Processes and network.** Programs without a shell through `exec`; `127.0.0.1` preview listener; the daily update-notice fetch,
  opt-in doctor checks, TCP `startChecks`, and the HTTP requests plugins ask for. Nothing else leaves the machine.
- **Global.** One process-wide API slot on `globalThis`, withdrawn at `session_shutdown`.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/*.test.ts"`
- Whole suite: `npm test`; types, lint and pins: `npm run check`; install check: `npm run check:install`.
- Docs: `node scripts/check-docs.mjs`

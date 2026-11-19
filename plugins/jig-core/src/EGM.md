# jig-core/src

## Overview

The tool manager's code. `index.ts` registers Pi's hooks; `gate.ts` and `results.ts` are the two hooks around every tool
call; `classify.ts`, `decide.ts` and `gates.ts` decide; `approvals.ts` asks you; `redact.ts`, `cap.ts`, `records.ts` and
`mask/` protect and record what comes back; `config.ts` and `state.ts` hold what plugins and `jig.json` give; `client.ts`
and `contract.ts` are what other plugins import. One call, followed through the files: [code map](../docs/code-map.md).
Plugin overview: [jig-core](../EGM.md).

## Interface

- **Subdirectories (each has its own contract):** [cli](./cli/EGM.md) (the `jig` command), [kit](#the-kit) (public helpers, described at the end of this file),
  [mask](./mask/EGM.md) (the masker), [watch](./watch/EGM.md) (watch engine and tool).
- **Entry (`index.ts`).** `jigCore(options?: JigCoreOptions): ExtensionFactory` (default export is `jigCore()`),
  `runningJigState()` for tests. Hooks: `session_start`, `before_agent_start`, `tool_call` (`gate`), `tool_result`
  (`toolResult`), `tool_execution_end` (`finishCall`), `turn_end` (`finishTurn`), `session_shutdown`. Also `/jig`
  (`registerCommands`), `/profile` (`registerProfileCommand`) and the `watch` tool.
- **Plugin surface.** `client.ts`: `jig()`, `withJig(use)`; jig-core only: `publishJig(api)`, `withdrawJig(api)`. `contract.ts`:
  types only, plus `JIG_EVENTS`. `api.ts`: `buildApi(state)`, each member a thin step onto `state.ts`, except `records.recall`, which
  writes a call-shaped record itself (call id `record-<uuid>`, facts `entries` and `queries`) outside any tool call.
- **Deciding.** `classify.ts` (`classify`), `decide.ts` (`decide`, `isOutside`, `sessionKey`, `commandMatches`, `ruleMatches`,
  `namesNothing`, `namesOutsideCommand`, `DecisionSource`: `floor` | `rule` | `session` | `tool` | `table` | `unknown` | `gate`), `gates.ts`, `environments.ts`,
  `protected-paths.ts` (`checkFileTool`, `FILE_TOOLS`, `defaultProtectedPaths`, `expandProtected`, `guardedEntry`, `otherAgentFolders`),
  `writable-folders.ts` (`writableFolders`: the working folder plus the folders the person allowed, compared by real path), `loaded-code.ts`.
  `codemode.ts` (`classifyCodemode`, `codemodeAsk`): a Pi `codemode` script of tool calls is a local read, and a script naming `models` or an
  escape hatch is an external write that asks.
- **Asking.** `approvals.ts` (inside the waiting call: Pi's selector, or the review screen in `tui` mode; the `form` kind has no screen yet and uses the selector; a tool's `always: "ask"` drops the "allow for this session" answer), `review.ts`, `preview.ts`, `preview-html.ts`,
  `preview-server.ts` (`createPreviewServer`, `MAX_PAGES` 50).
- **Results.** `redact.ts` (`createRedactor`, `REDACTED`, `RedactionError`, `secretForms`), `cap.ts` (`CAP_CHARS` 50,000,
  `capContent`, `cleanupSpill`), `records.ts` (`callRecord`, `turnRecord`, `writeRecord`, `cleanupRecords`, `recordsDir`,
  `cleanFacts`, `conditionProblem`).
- **Configuration and state.** `config.ts` (`jig.json` and company additions), `section-defaults.ts`, `section-state.ts`,
  `state.ts` (`createState`, `loadPersonalConfig`), `paths.ts` (`CONFIG_FILE_NAME`, `stateDir`, `configFile`, `privateDir`, `privateFolder`,
  `appendPrivateLine`, `createPrivateFile`, `replacePrivateFile`, `removeOldFiles`), `commands.ts` (`/jig`, `/jig setup`, `/jig doctor`,
  `/jig rules`, `/jig records`).
- **Services for plugins.** `secrets.ts` (references such as `pass:work/token`), `signin.ts`, `transports.ts`, `tunnels.ts`,
  `transports-section.ts` (`TRANSPORTS_SECTION`, `validateTransportsSection`, `relayOf`, `relayNames`, `tokenFilePaths`), `relay.ts`
  (`RELAY_PROTOCOL` 1, `relayRequest`, `relayHealth`; [relay protocol](../../../docs/relay-protocol.md)), `exec.ts`
  (`run`, `git`, `resolveProgram`, `GIT_FIXED_FLAGS`), `exec-output.ts` (`collector(limit, keep)`: the start, the end or both ends with the middle left out), `git-config-guard.ts` (`gitConfigRefusal`).
- **Doctor and setup.** `doctor*.ts` (`doctor-checks.ts`, `doctor-needs.ts`, `doctor-company-range.ts`, `doctor-json.ts`, ...), `secret-status.ts`, `secret-mounts.ts` (`windowsDrive`: a file on a WSL Windows drive mounted without `metadata` gets no mode warning), `pi-version.ts`,
  `model-auth.ts` (`modelAuthState`, `modelSignInLine`: whether the home has a model provider a person can use, from local files only);
  `setup*.ts` (`runSetup`, `buildSetupPlan`, `writeSetup`, `runSetupCommand`, ...), `onboarding.ts` and its `onboarding-*.ts` helpers
  (item kinds: `text`, `pick`, `reference`, `entry`, `object`, `proposal`, `login`, `info`; `onboarding-object-check.ts`: `checkObjectForms`, at most 8 forms of 20
  questions each, checked when the list or a plugin's `setup` is registered), `setup-ask-object.ts` (`askObject`, `fieldForRefusal`: one named
  object of a map), `setup-transports.ts` (`TRANSPORTS_SETUP`, `withTransports`, `transportNames`: the questions for jig-core's own `transports` section, which setup
  lists with the plugins' sections), `setup-relay-check.ts` (`checkRelay`: one `GET /v1/health`, never with the token), `setup-method-switch.ts` (`endSwitch`: what a chosen method takes out), `setup-reference-ask.ts` (`chooseReference`, `probeChosen`: where a credential is kept, shared by a single question and a field
  inside an object),
  `detect.ts` (`DETECTS`: `user`, `git-email`, `gh-account`, `aws-profile`; one fixed command each, 1.5 s, never secret), `plain-label.ts`.
- **Contract splits.** `contract.ts` stays the one import for plugins and re-exports `contract-onboarding.ts` (the onboarding and sign-in
  method types), `contract-run.ts` (`OutputKeep`, `RunOptions`, `RunResult`), `contract-sandbox.ts` (`SandboxProvider`,
  `SandboxNetworkMode`, `SandboxRunOptions`, `SandboxRunResult`: what a sandbox plugin registers, including the optional
  `brokerScript`) and `contract-watch.ts` (watch types); `api-options.ts` checks
  `registerSection`'s path lists and method sections before anything is registered.
- **Updating.** `update-versions.ts` (choosing a published version), `update-company.ts` (a company package's `jig.range`),
  `registry.ts`, `updates-section.ts` (the `updates` section), `update-notice.ts`. `jig update`'s plan and run are [cli/update.ts](./cli/EGM.md).
- **Profiles and start-up.** `profiles.ts`, `profile-state.ts`, `overlays.ts`, `profile-command.ts`; `start-jobs.ts`,
  `start-unlock.ts`, `start-checks.ts`, `tool-exposure.ts`. **Helper:** `errors.ts` (`errorMessage`).

## Invariants

- **A failure blocks the call.** Anything that fails inside `gate` blocks with `jig-core could not decide: <error>` and a
  record of kind `internal`; a failing plugin gate says `gate "<name>" (<plugin>) failed`. Exception: a `TypeError` from a declared
  tool's `classify` or `preview` blocks as invalid input (`<tool> cannot run with this input`, kind `invalid`, nobody asked).
  A tool never runs because jig-core could not tell.
- **Decision order is fixed** (`decide.ts`): the environment-kind by effect table (or the unknown default); the tool's own
  `atLeast`, only stricter; the first matching rule of the configuration; a session allow turning ask into allow; the floor
  last, which configuration can never lower. Floor: production writes denied, an unknown tool allowed by a wildcard (asks), `bash`
  outside its sandbox without a rule naming the command (asks), a tool declaring `always: "ask"` (asks; a rule may still deny),
  a call that needs a screen when there is none (denied), a file tool aimed at a protected path (denied), and a `write` or `edit`
  outside the folders `bash` can write or into a path that runs later outside the sandbox (asks; denied without a terminal, by
  `process.stdin.isTTY`, not `hasUI`). A rule that would lower the floor is refused at load.
- **Gates only tighten** (allow to ask, ask to deny), run only when the decision is not deny, and a gate that fails denies.
- **Classification order:** the tool's declaration, a `classify` rule, the built-in defaults for Pi's tools, the tool's hints,
  then unknown, which counts as a write to `external` and asks. A declared tool whose `classify` returns nothing (without
  `extendsDefaults`) goes straight to unknown. An unknown environment name counts as production.
- **Approvals happen only inside the waiting call.** No web endpoint approves; the preview server shows pages and never answers.
  A tool's `always: "ask"` leaves the waiting call two answers, allow once or decline, so no session allow can be recorded.
- **Results fail closed.** Redact every resolved secret in all spellings, mask production data, cap results over 50,000
  characters (the model keeps the first 8,000; the whole text goes to a spill file, best effort, and the result is cut even when
  that write fails). `read`, `bash`, `powershell`, `grep`, `find` and `ls` cut their own output and are never capped. A failure
  withholds the result; an image in a result that must be masked is replaced by `[image withheld: images cannot be masked]`.
- **Records never hold arguments or output.** One JSON line per call and per model turn, named facts only (strings over 64
  characters dropped), plus an `error` line: the first line of the redacted result (200 characters) for kind `tool` and `refused`,
  `blocked: <reason>` for a blocked call (a protected-path reason names the path).
- **`jig()` fails closed.** It throws `jig-core is not loaded` when the API is not published, so a Jig tool does not run
  ungoverned. `withdrawJig` runs on `session_shutdown`, so a plugin loading into the next runtime waits for the new core.
- **The factory registers and starts nothing long-lived;** configuration loads at `session_start`. Clean-up of old records,
  spill files and previews at start is best effort and never fails the start.
- **Setup adds one named object and never edits one.** An `object` item (a connection, a collection, an environment) asks a name,
  refuses a name already in the map (an empty name leaves a map that has entries as it is), asks the questions of the form that applies
  (`when` matches the section's merged value, else the form with none; several matching forms ask which kind), and writes the answers as one
  change at `path.<name>` only when the last answer is accepted. The section's own validator checks the whole object once, and a refusal asks
  again the field it names, else the whole form (or the name, when it is about the name). A credential inside it goes through the same "where is
  it kept" flow and is never typed or shown. `repeat` asks for another. An older Jig that does not know the kind refuses the item at
  registration. The doctor counts an `object` item as missing while its map is empty (`doctor-needs.ts`). Changing or removing an object stays
  the settings file's job ([Decisions](../../../docs/decisions.md#2026-11-17-setup-adds-one-named-object-of-a-map)). An empty `path` makes the
  section itself the map (`transports`), a form's `fixed` values are written without a question (`kind: "relay"`; a fixed path may not overlap a question's or another's), and `optional` lets an empty name
  leave the map unset. An object is found in a validator's messages by its key as text (`aboutObject`), never by a path read from the message, and a relay's name is 1 to 40
  letters, digits, `-` or `_` and not a transport a company plugin registered (`objectNameProblem`). When a sign-in method is chosen, the paths the other methods own (their
  required fields and the optional ones beside them, `SetupMethod.owns`) are removed as `remove` changes, and a check message that was not there before the pick reverts it; a validator's
  field is dropped for a method only while "How do you sign in?" is asked, and only for the paths the method owns. A `reference` with `fileExpected` is listed first as "A file", skips the
  "Use a file?" warning, and asks one line to turn the file store on when it is not on. A new relay is looked at once with `GET /v1/health` and no token; a method with `viaTransport` (its first field the transport's name, later ones optional, such as a `number` time limit) is always offered, as a pick of the transports that exist (the
  person's file, a company's defaults, one a company plugin registered, or one answered earlier in the run); while none exists, its pick carries `SetupField.create`, the relay question of `jig setup transports` (its `explain` says what a relay is first), which `askMethods` asks first and whose answer the pick then offers
  ([Decisions](../../../docs/decisions.md#2026-11-19-a-person-sets-up-a-session-relay-and-signs-in-through-it)).
- **The plugin list and Ctrl+C.** `pluginMenu` (`setup.ts`) titles the list with the changes not saved yet (`listTitle`). A cancel at the list with changes asks `ui.confirm("Save the N changes you made?", …, { defaultYes: true })`: yes (the default) goes on to `finish`, an explicit no cancels. A cancel inside one plugin's questions restores `draft` and `changes` to what they were before it and returns to the list.
- **Programs run without a shell** (`exec.ts`): an argument list, timeout 60 s, output cap 10 MiB (the start is kept unless
  `keep` says `tail` for the end or `both` for both ends, and the marker says how many bytes were left out), process group killed on
  timeout and at process exit, a minimal environment (`PATH`, `HOME`, `USER`, `LOGNAME`, locale, `TZ`, `TMPDIR`, XDG folders; git,
  `gh` and `glab` add `SSH_AUTH_SOCK`, `GIT_SSH*`, `GIT_CONFIG_*`, `DBUS_SESSION_BUS_ADDRESS` and fixed values such as
  `GIT_ALLOW_PROTOCOL=file:git:https:ssh`). A program whose real path is in a folder the agent's shell can write is refused. Every
  git call carries `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c color.ui=false`.
  git, `gh` and `glab` refuse a repository whose own config would run a command (not for `git clone`).
- **Credentials.** A program credential (`RunOptions.credential`, `gh` only) is resolved by jig-core, attached to that one
  call and registered for redaction; a plugin names the account, never the token. Nothing here signs in or stores a credential.
  The one exception is `jig().secrets.resolve`: a client library that must hold the secret in-process (the MongoDB driver in `jig-mongo`,
  an SSH tunnel) gets the value for that connection and must never return, log or record it
  ([Decisions](../../../docs/decisions.md#2026-11-17-a-library-that-must-hold-a-credential-gets-it-from-the-resolver)).
- **State folder privacy.** Folders 0700, files 0600; records are appended with one write per line; `removeOldFiles` deletes
  only regular files and never follows links; the update-notice cache goes through `privateFolder` and `replacePrivateFile` like
  the rest.
- **Limits.** A gate over 10 s counts as failed and denies the call; a tool's preview over 15 s becomes "preview unavailable"; 1,000
  calls are remembered at once, the oldest forgotten; `jig().sandbox.run` rejects a `timeoutMs` over 2 hours.
- **Pinned surface.** The API members, tool and action names, slash commands, `jig.json` sections, event names and `JIG_*`
  variables are literals in `test/surface.test.ts` and `plugin-surface.test.ts`; `test/audit.test.ts` pins each action's
  effect and approval. Never loosen a pin to get green; adding is fine, removing needs a Decisions entry.
- **A source file over 500 lines** is a ratchet (`plugins/jig-core/test/file-sizes.test.ts`): a new file may not cross 500, and a
  file listed in `scripts/file-sizes-baseline.json` may not grow; `test/code-maps.test.ts` fails when a file here is missing from, or
  listed in, the [code map](../docs/code-map.md).

## Side Effects

- **State folder** `$JIG_STATE_DIR`, else `${XDG_STATE_HOME:-~/.local/state}/jig`: `records/<date>.jsonl` (kept
  `records.retentionDays`, 90 by default), `spill/<session>/` and `previews/` (kept `spill.retentionDays`, 7), `skills/<profile>/<skill>/SKILL.md`
  (overlays), `watches/` and `mask/` (see the subfolders), the doctor's JSON report, `update-check.json` (notice cache) and
  `doctor-release.json` (network doctor cache).
- **`jig.json`** at `<agentDir>/jig.json`, where the Jig home (`~/.jig`, or `JIG_HOME`) is the agent folder for `jig` and Pi's
  `PI_CODING_AGENT_DIR` (else `~/.pi/agent`) is for a plain Pi. Only `setup-write.ts` writes it, called by `runSetup` (`jig setup`) and
  by `/jig setup` in a TUI whose agent folder is the home: re-read the target, refuse a changed file, back up an existing file, replace atomically.
- **Loopback listener.** `createPreviewServer` listens on `127.0.0.1`, random port, unref'd, rejects other `Host` headers,
  started only when a page is served (the `o` key of a review screen, or `approvals.openInBrowser: "always"`; a long preview alone
  starts nothing) and closed at `session_shutdown`.
- **Processes.** `exec.ts` spawns programs and SIGKILLs the groups of still-running children on process exit; `execFileSync` lists
  git config for the guard (10 s, 4 MiB); `detect.ts` runs `git config --get user.email`, `gh auth status` or
  `aws configure list-profiles` (1.5 s, 64 KiB, stderr ignored) when setup asks for a default; `preview-html.ts` spawns the browser
  detached (`$BROWSER` or the platform opener);
  `secret-status.ts` and `secrets.ts` run `pass`, `op`, Keychain lookups and configured `cmd:` commands, by metadata for status and
  by value for a resolve, and `unlockPass` decrypts one `pass` entry at session start (`secrets.pass.unlockAtStart`) and drops the
  value; the standalone `jig doctor` (`doctor-tools.ts`), with no sandbox provider active, forks the broker script the provider names
  (`SandboxProvider.brokerScript`, never a path into `jig-sandbox`; a provider that names none is checked for no broker; 5 s timer) and
  runs `bwrap --unshare-user`.
- **Network.** `update-notice.ts` (registry, once a day, silent offline or off; reads `NPM_CONFIG_*`, `PI_OFFLINE`), `doctor-network.ts`
  (opt-in), `start-checks.ts` (one TCP connection per `startChecks` entry, up to 16), and `kit/http.ts` behind `jig().http.request`.
  Start checks and the store unlock run only in a top-level session with a screen (never in a child agent); the update notice
  also runs with no screen and then writes to `process.stderr`.
- **Environment read:** `JIG_STATE_DIR`, `XDG_STATE_HOME`, `JIG_CONDITION` (validated at start), `JIG_AGENT_ROLE`, `JIG_PARENT_SESSION`,
  `JIG_HOME` (`cli/home.ts` and the doctor), `JIG_PI_HOST` (`cli/pi-command.ts`), `JIG_OUTER_PI_DIR` (`protected-paths.ts`, the outer Pi
  folder a `jig` session replaced), `PI_CODING_AGENT_DIR` (the theme preference), `PI_SUBAGENT_ID`, `PI_SUBAGENT_CHILD`, `PI_OFFLINE`,
  `NPM_CONFIG_REGISTRY` and the other `NPM_CONFIG_*` paths, `PATH` (`Path`, `PATHEXT` in the doctor), `HOME`, `BROWSER`, WSL variables. Secret lookups also read `PASSWORD_STORE_DIR`, `GNUPGHOME`, the display and D-Bus
  variables, every `OP_*`, the tool-config variables passed to `cmd:` commands (`GH_CONFIG_DIR`, `KUBECONFIG`, `AWS_*`...) and any
  variable an `env:<NAME>` reference names. Protected-path defaults read `XDG_CONFIG_HOME`, `APPDATA`, `DOCKER_CONFIG`.
- **Globals.** `globalThis[Symbol.for("jig.core.api/v1")]` and `...pending/v1` (`client.ts`); a module-level running state (`index.ts`).
- **Pi events.** Emits `jig:decision` and `jig:watch-done` on `pi.events` (`jig:stage-done` is emitted by `jig-workflow`). Timers in
  `gates.ts`, `preview.ts`, `start-checks.ts`, `update-notice.ts`, `exec.ts`, `doctor-tools.ts` and the watch engine.
- **Screen.** Configuration problems (first five, then "and N more") and the sandbox line go to `ctx.ui.notify` only when there is a UI.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/*.test.ts"`
- Whole suite: `npm test` at the repository root. Types and lint: `npm run check`.
- Docs: `node scripts/check-docs.mjs`

## The kit

The files directly in `src/kit/`. They are described here and not in a file of their own because `test/surface.test.ts` pins the exact list of files in that folder, so a contract file cannot live there.

### kit: Overview

The plugin kit: stateless helpers that other plugins import directly. With `../contract.ts` and `../client.ts`, the `.ts`
files directly in this folder are the only jig-core code a plugin may import
(`test/boundaries.test.ts`; [compatibility](../../../docs/compatibility.md)). Everything else in jig-core is internal. File
roles: [code map](../docs/code-map.md).

### kit: Interface

- **Request.** `createHttp(deps: HttpDeps): JigApi["http"]` (`http.ts`; `state.ts` builds `jig().http.request` from it),
  `HttpError`, `isHttpError`, `TransportRefusal`, `isTransportRefusal` (`http-error.ts`, re-exported by `http.ts`), `credentialsOf`, `REDACTED`,
  `DEFAULT_TIMEOUT_MS` (30 s), `MAX_TIMEOUT_MS` (10 min), `DEFAULT_MAX_BYTES` (4 MiB), `MAX_MAX_BYTES` (64 MiB).
  `createTokens(now)`, `REPLACE_EARLY_MS` (`oauth.ts`). `untilAborted(work, signal)` (`abort.ts`).
- **Tools.** `registerJigTool(pi, tool, options?)` (`tools.ts`: `pi.registerTool` plus default one-line renderers when the tool has none,
  `JigToolOptions.summary`, and an `execute` wrapper that calls `jig().markRefused` on a `RefusedError`), `TOOLS_SECTION`,
  `TOOL_SEARCH`, `NOT_DEFERRABLE`, `deferredToolNames`, `hasToolSearch`, `transcriptTools`, `JigToolOptions`.
  `stringEnum(values, { description?, default? })` (`schema.ts`). `isObject`, `InputError`, `RefusedError`,
  `NotConfiguredError`, `notSetUpMessage` (`values.ts`: the one line a plugin says while its section is missing, naming `/jig setup <section>` and `jig setup <section>` before the by-hand route; with `problem` it says the section is there but wrong and quotes it). `printable`, `stringOf`, `oneLine`, `shortList` (`text.ts`).
- **Actions.** `ActionSpec`, `ActionTable`, `usageLine`, `unknownAction`, `checkParams`, `describeActions`, `previewChanged`, `actionList`
  (`actions.ts`): one shape for an action-based tool, so its usage line, its refusal for an unknown action and its schema's action list
  read the same in every plugin.
- **Fields.** `closestField`, `unknownField` (`fields.ts`): the one unknown-field error, naming the closest valid key when one is within
  two edits, shared by jig-core's sections and every plugin's.
- **Roles.** `ROLE_POLICY_VARIABLE` (`JIG_ROLE_POLICY`), `writeRolePolicy`, `checkRolePolicy`, `readRolePolicy`,
  `TOOL_NAME_PATTERN`, `ACTION_NAME_PATTERN` (`role-policy.ts`).
- **Names and accounts.** `RENAMED_ACTIONS`, `canonicalAction`, `renamedAction`, `renamedInRules` (`action-names.ts`).
  `validateAccounts`, `accountPattern`, `accountFor`, `accountRemote` (`accounts.ts`, the `git.accounts` map).
- **Shared guard and sandbox tables.** `isDangerousGitSetting` (`git-settings.ts`), `RUNS_LATER`, `runsLaterPaths`,
  `isRepositoryRunsLater` (`runs-later.ts`), `PI_PROJECT_PATHS`, `projectFoldersBelowHome` (`pi-project-paths.ts`).
- **Machine.** `createFileDurably`, `replaceFileDurably`, `syncFolder` (`files.ts`). `browserCommand` (`browser.ts`).
  `findPrograms`, `onPath(command, path, writable?)` (skips a program whose path or real path `writable` accepts),
  `installCommand`, `distroOf`, `APPARMOR_SYSCTL` (`sandbox-programs.ts`). `freePort`,
  `waitForPort`, `portAccepts`, `socksAnswers`, `PortWaitError` (`ports.ts`).
- **Messages.** `MEMORY_*_MESSAGE` types and `MESSAGE_LABELS` (`jig-messages.ts`, used by `jig-memory` and `jig-session`).
- **Theme.** `themeCss()`, `themeAttribute(choice)` (`theme.ts`, server); `THEME_KEY`, `themeBootScript`, `themeControlScript`,
  `installTheme`, `resolvedTheme` (`theme-client.ts`, no Node imports); `readThemePreference`, `saveThemePreference`,
  `themePreferenceFile`, `agentDirFor(env, home)` (`theme-preference.ts`, the one rule for the agent folder: empty `PI_CODING_AGENT_DIR`
  is unset, no trimming, a leading `~` expands, a relative path stays relative, else `~/.pi/agent`; `index.ts` (`state.agentDir`),
  `cli/headless.ts`, `jig-lens` and `jig-review` all call it). `theme.css` is the one browser palette (`--jig-*` custom properties, light
  in `:root`, dark by `data-theme` or `prefers-color-scheme`). Not importable; read by `theme.ts` and by the review page's build.

### kit: Invariants

- **One file per helper, directly in `kit/`.** Subfolders are not public. Do not add state or Pi calls; the exceptions are
  `tools.ts` (registers with Pi), `oauth.ts` (an in-memory token cache) and `theme.ts` (a cached CSS string).
- **`ports.ts` imports only `node:net`:** a company plugin cannot import this file and keeps a copy.
- **The credential never reaches plugin code.** It is read just before the request from a configured source (`auth` is
  exactly one of `bearer`, `basic`, `header`, `query`, `signIn`, `oauth`) and is never returned.
- **No redirects followed** (`redirect: "manual"`); a 3xx is returned, so a credential cannot travel to another address.
- **Limits.** Body read as a stream and cut at `maxBytes` (1 B..64 MiB, `truncated: true`); `timeoutMs` 1..600,000 ms.
  The deadline starts at the first request that goes out, after the credential is in hand (unlocking may wait for a
  person); the timer is referenced and cleared in `finally`; `untilAborted` enforces it when a transport ignores its signal.
- **Scrubbing.** With a credential attached, every sent secret is removed from the reply body, headers and cookies in
  raw, JSON-escaped and URL-encoded forms, as `[redacted]`. Secrets under 8 characters are not scrubbed; longest first.
- **Errors are safe.** `HttpError` messages never hold header values, credentials or query strings; certificate failures say
  checks are never turned off. `notSent` is true only for failures before anything was written. A transport's refusal is a
  `TransportRefusal` with its own `code`, `notSent` and optional `requestId`, so a tool reports it without seeing a credential.
- **Validation is fail closed:** http or https URL, a known method, not both `auth` and a transport, a transport takes only
  GET, POST, PUT, PATCH, DELETE with a text body. There is no private-address check in `http.ts`.
- **One send, no retry,** except one resend after a 401 when an OAuth token came from the cache.
- **OAuth: no browser.** Only `client_credentials`, `password` and `command` grants. The token is memory only, replaced 60 s
  early (token-endpoint grants only; a `command` grant lives `cacheMs`, default 5 min, at most 15 min, and is always `fresh: false` so
  the one 401 resend re-runs the command), answer capped at 64 KiB, a `token_type` that is present must be `bearer` (a missing one is
  accepted), every failure is `auth_failed`, and the cache key is built from references, never secret values.
- **Tools go through `registerJigTool`,** so `tools.deferred` can hide a description until `tool_search` finds it;
  `NOT_DEFERRABLE` tools are never deferred.
- **One table for guard and sandbox.** `git-settings.ts`, `runs-later.ts` and `pi-project-paths.ts` are read by both the
  file-tool guard and the sandbox lock; add a path once and both change.
- **One role-policy parser** serves `jig-agents` and `jig-sandbox`, so they cannot disagree; an unreadable policy is the
  same problem for each.
- **`git.accounts` is ordered, first match wins,** matched against the real remote; a call cannot choose an account.
- **Writes are durable:** `createFileDurably` opens with `wx` (EEXIST if present), applies the mode (default 0600) with `fchmod`
  whatever the umask, writes and syncs. `replaceFileDurably` adds a temp file, the rename over the target and `syncFolder`.
- **Adding or renaming an export** updates the pinned surface in `test/surface.test.ts` first
  ([Decisions](../../../docs/decisions.md)). Legacy hyphenated action names map to snake_case in `action-names.ts`.

### kit: Side Effects

- **Network.** `http.ts` calls the injected `fetch` (default global) or a registered transport; `oauth.ts` sends its token request the same way.
- **Disk.** `files.ts` writes, renames, unlinks and syncs; `theme-preference.ts` reads and writes `<agentDir>/theme.json`
  (0600; a failed save must never fail a page); `theme.ts` reads `theme.css` once; `sandbox-programs.ts` stats, resolves (`realpathSync`) and checks access to `PATH` entries.
- **Environment.** `JIG_ROLE_POLICY` (`role-policy.ts`, through an `env` argument; the kit defines the parser, the readers are
  `jig-agents` and `jig-sandbox`, not jig-core), `$BROWSER` (`browser.ts`), and `PI_CODING_AGENT_DIR` (`theme-preference.ts`).
- **Sockets and timers.** `ports.ts` connects only to `127.0.0.1` (probe 2 s; `waitForPort` sleeps the caller's required `pollMs`); `freePort`
  listens on port 0, closes, then re-tests up to `attempts` (100) times 10 ms apart while the port still accepts, and returns it anyway. `http.ts` sets one deadline timer per request.
- **Pi.** `tools.ts` calls `pi.registerTool`, re-registers as deferred when named, subscribes to `session_start`, and on a `RefusedError` calls `jig().markRefused`.
- **No processes, no `process.exit`.** `sandbox-programs.ts` only returns install and sysctl text; it never runs it.

### kit: Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-core/test/kit.test.ts" "plugins/jig-core/test/boundaries.test.ts"`
- Docs: `node scripts/check-docs.mjs`

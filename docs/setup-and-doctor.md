# Setup and doctor

`jig doctor` looks at this machine, your Jig settings and the tools Jig uses, and says in plain words what is
wrong and what to do. The doctor reads only: it changes no setting, signs in to nothing, and never shows a password
or a token. `jig setup` fills in what is missing, and writes only what you confirm. Both run in a terminal, with no
Pi session, no model and no provider login. Inside Pi, `/jig doctor` shows the same report, and `/jig setup` tells you
to run the command.

## Run it

```text
jig doctor [--json] [--network] [--quiet]
```

It says "Checking your setup…" at once, then loads the same packages Pi loads. The first line is a count of what it found. Then come the groups: this machine, the configuration, secrets, logins,
the network, the sandbox and the records folder.

```text
Jig doctor · 8 ok · 1 warning · 2 failures · 7 skipped

This machine
  ✓ System — Linux, Node.js 24.15.0
  ! Pi — 1.4.0; this Jig is tested with 1.5.2
  ✗ Jig — not installed in ~/.pi/agent (the default folder), so Pi does not
       load Jig's plugins.
       If your Pi runs with PI_CODING_AGENT_DIR, run jig doctor with the same
       variable.
       fix: pi install npm:@clawdbuilder/jig
  ✓ Pi's folder — ~/.pi/agent, the default
...
```

A check starts with **✓** (ok), **!** (warning), **✗** (failure) or **–** (skipped). The words come back when `NO_COLOR` is set,
`TERM=dumb`, or the locale (`LC_ALL`, `LC_CTYPE` or `LANG`) is not UTF-8, so a plain terminal still reads `ok`, `warn`,
`fail` and `skip`. The summary line keeps its words. `--json` is unchanged.

This machine names the Pi folder it checked and why: `~/.pi/agent, the default` or the path `from PI_CODING_AGENT_DIR`.
When Jig is not installed there, the `Jig` row names the folder and carries the hint: "If your Pi runs with
`PI_CODING_AGENT_DIR`, run `jig doctor` with the same variable."

Exit code `0` means no failures, `1` means at least one; `--json` prints one JSON report with `"schema": 1` on stdout and
nothing else (failures still exit 1); every line carries `durationMs`, the milliseconds its check took. The exit codes are the same for every command: 0 success, 1 a failure, 2 a usage error
or a missing required flag. It works when `jig.json` is invalid or a plugin fails to load: that is a failure line in the report, not
a crash, because that is exactly when you need it. If Jig is not installed in Pi, or Pi itself is not found, the machine
group has a failure with the command to install it: the doctor does not give an all-clear for a Jig Pi will not load.
Two copies with different versions are a warning.

**Getting the command.** Pi's `pi install` copies a package but does not link programs. Install Jig with npm, which
does: `npm install -g @clawdbuilder/jig` puts `jig` on your PATH (the same folder as `node` and `npm`), on Linux, WSL and
macOS. Add `@0.5.4` to install a release rather than the latest. For a checkout,
`npm install -g --install-links <checkout>` does the same from the folder, and `npm link` inside it is for development.
Setup never edits your shell files.

The command runs from `node_modules`, where Node will not strip TypeScript itself: its first line installs a small loader
that does, so the installed copy behaves like a checkout. If `jig` cannot find Pi, it says so with the folder to set in
`PI_HOST_DIR`.

## Setting up

```text
jig setup
```

Setup needs a terminal: its company, profile and credential choices have no safe headless default; without one it says so
and exits 2. It starts with the company question: which installed company setup you use, or "None, just me", and for which folders
(`everywhere` by default). That writes the `profiles` and `profile` entries a newcomer cannot be expected to know. Then
setup asks one question at a time about the parts a company plugin or a validator says are incomplete or wrong.
It never asks for a password or a token. For a credential it asks **where** it is kept, never what it is: choose
1Password, the macOS Keychain, pass, an environment variable, a file, or a tool that owns the login. The company's
choice comes first and is marked. Then setup asks the plain parts, such as the vault, item and field, and builds the
reference itself; you never type `op://` or `pass:`.

After each credential it says **Found**, **Missing**, **Locked** or **Not checked**, never a value. A missing one
comes with the store's own command to add it, and **Check again**. A file is the weakest choice: it is plain text
on disk, and setup warns before using one. If the store was off, setup turns it on as a place Jig reads from; it
never changes the stores you turned off.

Before it writes, it shows one line per change, in plain words. "Show the exact change" reveals the JSON.
Nothing is written until you confirm. It keeps a backup next to the file and says to start Pi again, or run `/reload`
in it. Without a terminal it refuses in one line, names why it needs a terminal, and exits 2; the doctor still runs. Exit code `0` is done or
nothing to do, `1` failed, `2` a usage error or an interactive step without a terminal, `130` cancelled.

If your settings file is a link, as a dotfiles setup often makes it, setup follows the link, says which file it
will change, and writes that file. The link stays a link. A link that points nowhere, or to a folder, is refused
and nothing changes.

## Updating

```text
jig update [--check] [--json] [--to <version>] [--yes]
```

`--json` prints one object with `"schema": 1` (`current`, `target`, `action`, `changes`, `pi`, `code`) on stdout. `--yes` (or
`CI=true`) is required without a terminal; without it the command names the flag and exits 2. The confirmation reads
`Update Jig <old> → <new>? [y/N]` and the confirmation itself is not echoed.

Jig is installed in two copies: Pi's package and the global `jig` command. `jig update` moves both to one published stable
version, in that order: Pi when the release needs a newer one, then Pi's copy, then the global command, then a check of both
and a scoped check: both copies on the new version, the global command, Pi's settings and that Jig loads. It ends with
“Full check: jig doctor (run it in a project folder; company checks depend on the folder)” and does not run company checks. It needs a terminal, like `jig setup`; `--check` says what would happen and changes nothing. `--to` names a
published version instead of the newest. `--check` needs no write access and runs no PATH check; it exits 0 when the plan was made (whether or not an update is
available) and 1 on an error. A normal update exits 0 on success and
1 on failure.

A release states the oldest Pi it runs with and the one it is tested with, in `jig.agents.pi`. If the installed Pi is older
than the oldest, update asks a yes/no question, defaulting to No, and installs the exact tested Pi; No changes nothing. It
never installs "the latest Pi". If Pi is newer than the tested one, it says so and continues. Pi's own `pi update` still
works and is not blocked; if it moves Pi past the tested version, the doctor and the next start warn, and do not block.

A company package can cap which Jig versions are allowed with `"jig": { "range": ">=0.4.1 <0.5.0" }` in its package.json.
Update stops at the newest version inside every installed company's range and names the range. If Pi's Jig copy is a
checkout or a git source, update tells you to run `pi remove <source>` first, then the npm install, and changes nothing.
Pi's Jig entry is pinned to the new version so `pi update` leaves it alone; `jig update` moves it next time. An exact pin
that names Jig is also moved, and the line before the change says `pinned to X, moving to Y`; a company's hold is its
`jig.range`, not a pin. The original entry, pinned or unpinned, is what an undo restores. If Pi lists more than one Jig
entry, update refuses before changing anything and lists each with the `pi remove <source>` that leaves one.

It asks npm for the published versions (`npm view`), so npm's registry, scope mapping, credentials and `.npmrc` rules
apply to the check and the installs alike.

Before the first change it checks the registry, the target's Pi versions, that its settings folder is writable, that `npm`
and `pi` are on PATH, and how Pi was installed. Pi is installed by its own method with the exact tested version; after the
step update reads Pi's version and fails, with undo, if it is not exactly that version. If that command cannot be built, update
prints the command and stops. If any step fails, it puts every version it changed back and says what happened. An
interrupted update does the same and prints the commands to restore by hand when an undo cannot run. Open Pi sessions keep the old code until restarted.

### The notice inside Pi

At most once a day, in the background, Jig asks the npm registry whether a newer stable release exists and tells you on
your screen: "Jig X is available... run `jig update` in a terminal." In print mode it writes the same line to stderr, so
it reaches you and never the model's context. The notice respects the company cap, is silent when
offline or when `PI_OFFLINE` is set, and never reaches the model's context. If the running version is deprecated on npm,
it says so more strongly. It also warns once when Pi is newer than the tested version. Turn it off with
`"updates": { "check": false }`; a company default can turn it off too, and your file wins. The check is cached in Jig's
state folder.

## This folder's Pi packages, and trust

Project packages (the `packages` in `<folder>/.pi/settings.json`, cloned under `<folder>/.pi/git`) are code, and Pi loads
them only after you trust the folder. `jig doctor` and `jig setup` follow the same rule: they read the folder's settings
and package folders for facts, but they import and run nothing from project scope until Pi's own saved decision in the
agent folder's `trust.json` says yes, or the agent folder's settings say `defaultProjectTrust: "always"`. A closer "do not
trust" wins over a parent's trust; a missing, unreadable or malformed `trust.json` fails closed. The doctor then shows a
`skip` line naming what was not loaded and how to trust the folder in Pi; setup says the same instead of asking questions.
User-scope packages are unaffected. Pi's `project_trust` extension event is not imitated: there is no screen for it here,
and loading less is the safe direction.

## Loading only some plugins

Pi can load only some of Jig's plugins. Name each plugin by its entry file, `plugins/<name>/index.ts`; a filter that
names `src/index.ts` matches nothing. Keep `jig-core` first in the list, because every other plugin needs it:

```json
{
  "packages": [
    {
      "source": "npm:@clawdbuilder/jig",
      "extensions": [
        "plugins/jig-core/index.ts",
        "plugins/jig-sandbox/index.ts",
        "plugins/jig-git/index.ts"
      ]
    }
  ]
}
```

`jig doctor` reads the filter and fails when it leaves out `jig-core` or `jig-sandbox`, or when a plugin's section in
`jig.json` is left behind.

## The four words

| Mark | Word | What it means |
|---|---|---|
| ✓ | `ok` | This works. |
| ! | `warn` | This works, but something is worth knowing. |
| ✗ | `fail` | A tool that needs this will fail. |
| – | `skip` | This was not checked, or does not apply here. |

Each `warn` and `fail` has a `fix:` line under it. The fix is a command or an action for you; Jig does not run it.
A `skip` has no fix line. Repeated secret rows with the same outcome and source collapse into one counted line. When the names form a grid, it
shows the axes: `– Ops job tokens — 20 come from a command, not read: 10 services (orders-api, billing-api,
payments-api, …) × staging, qa`. Mongo groups read `✓ Mongo connections — 12 found in pass: staging, qa, prod × app,
reports (user and password)`. When they do not form a grid, it keeps the plain list. `--json` still has one entry per reference.

## What it looks at

| Area | What it checks |
|---|---|
| This machine | Node.js, Pi, Jig, the system and Pi's folder |
| Configuration | the settings file, each plugin section, and the protected files |
| Secrets | the stores that are on, and each reference: found, missing, locked or not checked |
| Logins | `gh` and `glab`, only when your settings use them |
| Network | only with `--network`: the configured hosts and the latest release |
| Sandbox | whether `bash` is sandboxed, and the programs it needs |
| Records | where today's records go, and whether they can be written |

A `skip` is not a failure. Every store is asked for metadata only: an entry exists, a variable is set, a file's
size and mode, a Keychain lookup without the password, a 1Password item list without its fields, or a login
tool's own status. A field's value is never read to check it.

## Fixing a finding

- **A missing secret.** Setup shows your own store's command, such as `pass insert work/jira-token`, and offers
  Check again. Run it in your own terminal; Jig never asks for the value.
- **A section that is not loaded.** The message names the key. A company's defaults can wait for the part only you
  know, such as your login on a bastion host.
- **A login tool that is not signed in.** The fix is its own command, such as `gh auth login`.
- **A program that is missing.** The fix is the install command. Jig installs nothing.

## The report file

```text
/jig doctor --json
```

writes `doctor.json` to Jig's state folder: `~/.local/state/jig` unless `JIG_STATE_DIR` says otherwise. The output
says the path.

The file is JSON with `"schema": 1`. A later version may add fields, but does not change or remove one. It holds no
password, token or secret reference: for a reference it says which store was asked and what was found, and the fix
may name the entry to add.

## Checking the network

```text
/jig doctor --network
```

This is opt-in. It makes one TCP connection to each host and closes it: in parallel, 3 seconds each, with nothing
sent. The hosts are the `startChecks` in your settings and the addresses written in the plugin sections.

It also checks the latest Jig release, from the repository named in Jig's `package.json`, at most once a day. A host
that does not answer, a release page that cannot be read, or a repository that is not on GitHub is a warning or a
skip, never a failure.

## Less noise

```text
/jig doctor --quiet
```

shows only the warnings and failures, with the summary. The full report is still what `--json` writes.

## What it never does

- It never asks for, shows, stores or records a secret value.
- It never signs in, unlocks a store, or refreshes a login ([Credential sources](../plugins/jig-core/docs/sign-in-and-transports.md)).
- The doctor never changes `jig.json`; setup writes only the fields you confirm, and never rules, protected
  paths or the list of stores you turned off.
- It never installs a program or runs a fix.
- It never contacts a host without `--network`.

The checks in detail are in [Configuration](../plugins/jig-core/docs/configuration.md#the-jig-commands). Where a reference comes from is in
[Secrets](secrets.md#later).

For 0.5.4, install the npm package `@clawdbuilder/jig@0.5.4`; the tarball is checked with the npm versions CI uses. The
doctor checks the sandbox broker, the built-in roles folder and every Jig copy Pi loads.

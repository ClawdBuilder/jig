# Setup and doctor

`/jig doctor` looks at this machine, your Jig settings and the tools Jig uses, and says in plain words what is
wrong and what to do. The doctor reads only: it changes no setting, signs in to nothing, and never shows a password
or a token. `/jig setup` fills in what is missing, and writes only what you confirm. Both run inside Pi, in the folder
Pi uses. In a [separate Jig home](#a-separate-jig-home-optional), `jig doctor` and `jig setup` do the same in a
terminal, with no Pi session, no model and no provider login.

## Run it

```text
/jig doctor [--json] [--network] [--quiet]
```

The first line is a count of what it found. Then come the groups: this machine, the configuration, secrets, logins,
the network, the sandbox and the records folder.

```text
Jig doctor · 21 ok · 1 warning · 0 failures · 7 skipped

This machine
  ✓ Node.js — 24.15.0 (Jig needs 22.19.0 or later)
  ✓ Pi — 1.5.2
  ✓ Jig — 0.5.10
  ✓ System — Linux
  ✓ Pi's folder — ~/.pi/agent, the default folder
...
Logins
  ✓ Model — 3 models available
...
Sandbox
  ! Sandbox — bash is not sandboxed; a shell command can read your credentials.
       fix: Install jig-sandbox, or run Pi inside a container.
```

A check starts with **✓** (ok), **!** (warning), **✗** (failure) or **–** (skipped). The words come back when `NO_COLOR` is set,
`TERM=dumb`, or the locale (`LC_ALL`, `LC_CTYPE` or `LANG`) is not UTF-8, so a plain terminal still reads `ok`, `warn`,
`fail` and `skip`. The summary line keeps its words. `--json` is unchanged.

This machine names the folder it checked and why: Pi's folder (`~/.pi/agent, the default folder`, or the path
`from PI_CODING_AGENT_DIR`). In a separate home the row is `Jig home`: `~/.jig, the default home`, or the path
`from JIG_HOME`. When Jig is not installed in the folder the terminal command checks, the `Jig` row names the folder, and
the fix installs it where the command runs.

**In a terminal** (`jig doctor`, in a separate home), exit code `0` means no failures, `1` means at least one; `--json` prints one JSON report with `"schema": 1` on stdout and
nothing else (failures still exit 1); every line carries `durationMs`, the milliseconds its check took. The exit codes are the same for every command: 0 success, 1 a failure, 2 a usage error
or a missing required flag. It works when `jig.json` is invalid or a plugin fails to load: that is a failure line in the report, not
a crash, because that is exactly when you need it. If Jig is not installed in Pi, or Pi itself is not found, the machine
group has a failure with the command to install it: the doctor does not give an all-clear for a Jig Pi will not load.
Two copies with different versions are a warning.

**The model.** The `Model` line asks Pi how many models it can use: `Model — 3 models available`, or `Model — none available.
Type /login.` as a warning. `/jig` shows the same line. The terminal doctor has no Pi to ask, so it reads the folder's files
([What it looks at](#what-it-looks-at)).

## Packages

A Pi package goes into your own Pi with `pi install npm:…`. A package installed by name is unpinned, so
`pi update --extensions` moves it to the newest release; `npm:<pkg>@<version>` keeps it where it is. `pi install -l` writes the project's
`.pi/settings.json`, which both `pi` and a separate home read. The launcher is optional; [The launcher](launcher.md)
covers it, and Jig works without it.

## Setting up

```text
/jig setup [section]
```

`/jig setup` asks its questions in Pi's dialogs, in the folder Pi uses, and writes that folder's `jig.json`: `~/.pi/agent/jig.json`
by default. In a Pi mode with no screen (print or RPC) it tells you to open Pi in a terminal and run it. In a separate home,
`jig setup` asks the same questions in a terminal ([Setting up in a terminal](#setting-up-in-a-terminal)).

It starts with the company question: which installed
company setup you use, or "None, just me", and where it applies: every folder, only this folder, or, when the company names
remote patterns, repositories matching them. The last writes `when.remotes`. That writes the `profiles`
and `profile` entries a newcomer cannot be expected to know. Then setup asks one question at a time about the parts a
company plugin or a validator says are incomplete or wrong.

**The plugin list.** After those questions, setup shows every plugin that said what it needs, one line each: its name, its
status and a one-sentence summary. The status is `set up` (its settings pass its own check), `not set up` (it has questions
to ask), `not set up (questions coming)` (it needs settings setup cannot ask for yet: it says which page to read and shows a
section to add by hand), `ready (optional settings)` (every question is optional and the plugin works with nothing written;
pick it to answer them), or `ready` (nothing to ask; Jig's defaults apply). Pick a plugin and setup asks its questions,
including how you sign in; it comes back to the list afterwards, and a plugin you set up shows `set up`. A plugin that adds
one entry of a map, such as a database connection for each environment, asks for the name first, says what is already
there, and can be left as it is. **Done** writes everything once, with one backup and one confirmation, so a cancel writes
nothing.

The list's title counts the settings not saved yet (`(2 unsaved changes)`). Ctrl+C at the list, with changes not saved, asks
"Save the 2 changes you made?" with Yes as the default (`(Y/n)`). Enter goes to the review, where you can still cancel; only an
explicit `n`, or a second Ctrl+C, writes nothing and ends setup (exit code 130, "Nothing was written.").

Ctrl+C inside one plugin's questions puts that plugin back as it was and returns to the list, so the plugins you answered
before it are not lost. When setup is not asking anything (Pi is installing, or Jig is looking at a relay), Ctrl+C ends the run
at once, as in any program, and nothing is written.

**In Pi.** `/jig setup` asks the same questions in Pi's dialogs, which have no numbers, and Esc is what Ctrl+C is in a terminal:

- Esc inside one plugin's questions puts that plugin back as it was and returns to the list.
- Esc at the list, with changes not saved, asks "Save the 2 changes you made?". Yes is selected, so Enter saves: it goes to the review, and No ends the run.
- Esc in the questions before the list, at the review or at the last confirmation ends the run.

When a run ends without saving, Pi restores `jig.json` as it was before `/jig setup`, including a company choice setup had
already written, and says so, naming the backup when setup made one.

**A session relay.** The first line of the list, `Transports`, adds a [relay](relay-protocol.md): a program that holds your session
for Jira or logs, such as a browser extension's local host. Setup asks its name (letters, digits, `-` and `_`, up to 40, and never the name of a transport a company plugin registered), its address (plain `http` only for
`127.0.0.1`, `localhost` or `[::1]`) and where its token is kept, a file being the usual place, listed first. Then it asks the relay once
whether it is running with `GET /v1/health`, which needs no token, and says what it found; it never sends or reads the token.
`/jig doctor` checks the same health, the protocol and the token later, without `--network`. Jira and logs always offer
"Through a session relay or transport" among their sign-in methods, and ask one optional time limit for a request (5 to 120
seconds). Choosing it before any relay exists says what a relay is and that it must be running on this machine, then asks the relay's questions right there, so Jira can be picked first. Details: [Credential sources](../plugins/jig-core/docs/sign-in-and-transports.md#relay-transports).

The time-limit question says what Enter keeps: the value in your file, or the default while it is unset. It is for most requests; a Jira search has its own limit, `searchTimeoutSeconds` (60 seconds), which setup does not ask.

**Signing in another way.** Choosing a sign-in method removes the fields of the methods it replaces (an email and a token when you pick a relay), and keeps a setting that belongs to no method, such as a time limit. Setup then runs the plugin's own check on the result. If it still fails, setup leaves that sign-in as it was and says the check's words.

`/jig setup <section>` goes straight to that section's questions, without the list. A plugin's own questions come after a
company's list, and a company default or answer skips the question it already answers. `--yes` asks nothing and sets up
nothing new when there is no terminal, so a script can finish; at a terminal setup asks its questions anyway.

It never asks for a password or a token. For a credential it asks **where** it is kept, never what it is: choose
1Password, the macOS Keychain, pass, an environment variable, a file, or a tool that owns the login. The company's
choice comes first and is marked, and so is the place you already use. Then setup asks the plain parts, such as the
vault, item and field, and builds the reference itself; you never type `op://` or `pass:`.

After each credential it says **Found**, **Missing**, **Locked** or **Not checked**, never a value. A missing one
comes with the store's own command to add it, and **Check again**. A file is the weakest choice: it is plain text
on disk, and setup warns before using one, except for a relay's token, which the relay writes to a file itself: that one lists "A file" first and asks one line to turn files on when they are not a place Jig reads from yet. If the store was off, setup turns it on as a place Jig reads from; it
never changes the stores you turned off. A plugin or company list may add its own hint, such as `pass insert work/jira-pat`;
setup shows it and never runs it.

Before it writes, it shows one line per change, in plain words. "Show the exact change" reveals the JSON.
Nothing is written until you confirm. It keeps a backup next to the file and says to run `/reload` in Pi (the terminal
command says to start Pi again, or run `/reload`). In a terminal, exit code `0` is done or nothing to do, `1` failed, `2` a usage
error or an interactive step without a terminal, `130` cancelled.

If your settings file is a link, as a dotfiles setup often makes it, setup follows the link, says which file it
will change, and writes that file. The link stays a link. A link that points nowhere, or to a folder, is refused
and nothing changes.


## Updating

In your own Pi, Jig installed by name moves with `pi update --extensions` (every package) or `pi update npm:@clawdbuilder/jig`
(Jig only). A pinned entry moves with `pi install npm:@clawdbuilder/jig@<version>`. `pi update` alone replaces only the Pi
program, which every other `pi` on the machine shares: decide that separately.

A Jig listed as a folder, a git clone or a link gets no update notice, from Pi or from Jig: whoever owns the checkout moves it.

A company package can cap which Jig versions are allowed with `"jig": { "range": ">=0.4.1 <0.5.0" }`. Pi's own update ignores
the cap, so the notice below names the install command with the version the cap allows. `/jig doctor` warns when the running
Jig is outside the range, and its fix is `pi install npm:@clawdbuilder/jig@<version>` with a version inside it.

### In a separate home: `jig update`

```text
jig update [--check] [--json] [--yes] [--to <version>] [target]
```

`jig update` moves the packages in the home through Pi's own update, with the home as `PI_CODING_AGENT_DIR`. It never
updates the Pi binary, because your `pi` and any other Jig home share it; `pi update --self` does that.

| Command | What it moves |
|---|---|
| `jig update`, `--all` | Jig, then every unpinned package in the home |
| `--self`, `self` | Jig only (in Pi, `--self` means Pi itself) |
| `--extensions` | the other packages in the home |
| `--models` | Pi's built-in model catalogs only |
| `<source>`, `--extension <source>` | that one package |
| `pi`, `--force` | refused, naming `pi update --self` |

Setup pins Jig's own entry to the version it installed, so `pi update` leaves it alone and `jig update` moves it, and Pi then
shows Jig's new changelog entries on its next start. Other pinned packages stay where they are, as in Pi. A company package can cap which Jig versions are allowed with
`"jig": { "range": ">=0.4.1 <0.5.0" }`; update stops at the newest version inside every installed company's range and
names the range. `jig doctor` warns when the running Jig is outside one of those ranges, and says nothing when it is
inside.

`--models` refreshes Pi's built-in catalogs only. Pi builds that runtime without loading extensions, so an extension
provider's list is not touched: jig-bedrock refreshes with `/bedrock refresh`, or when `/model` opens on a list more
than a day old. The help says so too.

A release states the oldest Pi it runs with in `jig.agents.pi`. After moving Jig, when the new Jig needs a newer Pi than
installed, update says so, names `pi update --self`, and stops before anything else moves. It never installs Pi. If Pi
is newer than the tested version, it says so and continues.

Two Jig entries in the home are refused, with the `pi remove` that leaves one. Before a step it cannot finish,
update stops: no Jig in the home, no Pi found, or a home it cannot write. It asks npm
for the published versions (`npm view`), so npm's registry, scope mapping, credentials and `.npmrc` rules apply to the
check and the install alike.

`--check` says what would change and changes nothing; it exits 0 when it could make a plan and 1 on an error. `--json`
prints one object with `"schema": 1` (`current`, `target`, `action`, `commands`, `code`) on stdout. `--yes` (or
`CI=true`) is required without a terminal; without it the command names the flag and exits 2. `--to` names a published
Jig version instead of the newest. Open Pi sessions keep the old code until restarted.

### The notice inside Pi

At most once a day, in the background, Jig asks the npm registry whether a newer stable release exists. In a separate home it
tells you on your screen: "Jig X is available... Run jig update in a terminal." In your own Pi folder Pi prints its own
"Package updates are available", so Jig adds a line only where Pi says nothing: an entry pinned to one version, or a company
cap on the version. That line gives `pi install npm:@clawdbuilder/jig@<version>` with the version allowed.

In print mode the notice goes to stderr, so it reaches you and never the model's context. It respects the company cap, is
silent when offline or when `PI_OFFLINE` is set, and is stronger when the running version is deprecated on npm, with the same
install command (in a home, `jig update`). It also warns once when Pi is newer than the tested version: a home is pointed at
`jig update`, a Pi folder at installing the tested Pi. Turn it off with `"updates": { "check": false }`; a company default can
turn it off too, and your file wins. The check is cached in Jig's state folder.

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

The doctor reads the filter and fails when it leaves out `jig-core` or `jig-sandbox`. Any other plugin you leave out is one
`skip` line, `Off: api, jira, logs.`, and its section in `jig.json` stays and is not a problem.

In a terminal that line has a `fix:`, the settings file to change; `/jig doctor` in Pi names no file. A section that belongs
to no plugin is still an unknown field.

## A separate Jig home (optional)

Everything above works in the folder your own `pi` uses. A separate home is for a person who wants Jig kept apart from it,
with its own settings, sessions and packages. [Decisions](decisions.md#2026-11-12-jig-lives-in-its-own-pi-folder-and-jig-is-pi-for-it)
has why it exists; the 2026-11-19 entry says it is now optional.

**The home and the `jig` command.** `jig` is Pi for Jig's own folder, the home: `~/.jig`, or `JIG_HOME`. Your own
`pi` keeps `~/.pi/agent` and is not changed. One command makes both: `npx @clawdbuilder/jig setup` checks Pi, makes the
home, runs `pi install npm:@clawdbuilder/jig@<version>` with the home as Pi's agent folder, and writes the `jig`
command to `~/.local/bin` (or `--bin <folder>`). It never overwrites a file there that is not Jig's, and says whether
the folder is on your PATH with the line to add when it is not. Setup never edits your shell files.

A `jig` command that already runs another home is kept: setup names the home it runs and the two ways to reach this one,
`JIG_HOME=<new home> jig …`, or a second command with `--bin <folder>`. In a terminal it offers to replace the command,
and the answer is no unless you say yes; `--yes` never replaces it.

Every `jig` command runs with the home as `PI_CODING_AGENT_DIR` and ignores an outer one. A `jig` started from
anywhere else — a global npm copy, a checkout, `npx` — hands over to the Jig installed in the home, so the command and
the plugins are one version. When the home has no Jig, only `setup`, `help` and `--version` run; the others say
`Jig is not installed in <home>. Run: npx @clawdbuilder/jig setup` and exit 2.

The command runs from `node_modules`, where Node will not strip TypeScript itself: its first line installs a small loader
that does, so the installed copy behaves like a checkout. If `jig` cannot find Pi, it says so with the folder to set in
`PI_HOST_DIR` (or `JIG_PI_HOST`).

**Packages.** A package goes into the home with `jig install npm:…`, or into both with `pi install` and `jig install`.
`jig install -l` writes the project's `.pi/settings.json`, which both read; `jig update` ([above](#in-a-separate-home-jig-update))
moves the home's unpinned packages.

### Setting up in a terminal

```text
jig setup [section] [--bin <folder>] [--source <source>] [--from <folder>] [--yes]
```

On a machine with no home, setup does the install above, then asks its questions. `--bin` names where the `jig`
command goes, and `--from` names an older Jig folder to offer settings from. `--source` is for the tests: a packed copy
to install instead of the published package. A file at the `jig` command's path that is not Jig's is left alone, and setup stops and says so.
A `jig` command that runs a different home is left alone too, and setup says which home it runs.

**Migration.** When `~/.pi/jig-agent/jig.json` exists, or `--from` names a folder with one, setup offers to copy
`jig.json` into the home. `auth.json` and `sessions/` are separate offers with their own yes, because they hold your
sign-ins and history. Nothing is moved or deleted: the old folder stays as it was.

**Running it again** does the questions only, and repairs a `jig` command that is missing, or that an older setup wrote
for this home. **Uninstalling** is deleting the home and the `jig` command.

The questions need a terminal: their company, profile and credential choices have no safe headless default. With
`--yes` setup takes the safe answers and skips them, so a script can finish. Without a terminal and without `--yes` it
does the install, says the home is ready and that the questions need a terminal, names those two ways, and exits 2.

## The four words

| Mark | Word | What it means |
|---|---|---|
| ✓ | `ok` | This works. |
| ! | `warn` | This works, but something is worth knowing. |
| ✗ | `fail` | A tool that needs this will fail. |
| – | `skip` | This was not checked, or does not apply here. |

Each `warn` and `fail` has a `fix:` line under it. The fix is a command or an action for you; Jig does not run it.
A `skip` usually has no fix line. Repeated secret rows with the same outcome and source collapse into one counted line. When the names form a grid, it
shows the axes: `– Ops job tokens — 20 come from a command, not read: 10 services (orders-api, billing-api,
payments-api, …) × staging, qa`. Mongo groups read `✓ Mongo connections — 12 found in pass: staging, qa, prod × app,
reports (user and password)`. When they do not form a grid, it keeps the plain list. `--json` still has one entry per reference.

## What it looks at

| Area | What it checks |
|---|---|
| This machine | Node.js, Pi, Jig, the system and Pi's folder |
| Configuration | the settings file, each plugin section, and the protected files |
| Secrets | the stores that are on, and each reference: found, missing, locked or not checked |
| Logins | the model (Pi's count of usable models), plus `gh` and `glab` when your settings use them |
| Network | only with `--network`: the configured hosts and the latest release |
| Sandbox | whether `bash` is sandboxed, and the programs it needs |
| Records | where today's records go, and whether they can be written |

Inside Pi the model line is Pi's own count: `ok` with `3 models available`, `warn` with `none available. Type /login.`
The terminal doctor has no Pi to ask, so it reads the folder: `ok` when `auth.json` names a provider or a provider key is set
in the environment, `warn` when it has neither and no extension is installed, and `skip` when an extension package other than
Jig itself is installed (such as jig-bedrock), because its provider cannot be checked without loading Pi. The fix for a
warning is `/login` in Pi; in a home it can also be `jig auth login <provider>` in a terminal.

A `skip` is not a failure. Every store is asked for metadata only: an entry exists, a variable is set, a file's
size and mode, a Keychain lookup without the password, a 1Password item list without its fields, or a login
tool's own status. A field's value is never read to check it.

## Fixing a finding

- **A missing secret.** Setup shows your own store's command, such as `pass insert work/jira-token`, and offers
  Check again. Run it in your own terminal; Jig never asks for the value.
- **A section that is not loaded.** The message names the key. A company's defaults can wait for the part only you
  know, such as your login on a bastion host.
- **A plugin that is not set up.** The doctor's line says `not set up:` with what the plugin does and
  `Run /jig setup <section>.` Nothing is wrong until its tools need it; setup's plugin list asks the questions. A plugin
  whose questions are all optional, and whose section works with nothing written, gets no line: it runs on its defaults.
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

For 0.5.10, install the npm package `@clawdbuilder/jig@0.5.10`; the tarball is checked with the npm versions CI uses. The
doctor checks the sandbox broker, the built-in roles folder and every Jig copy Pi loads.

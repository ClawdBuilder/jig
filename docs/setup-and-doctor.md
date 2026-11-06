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

Exit code `0` means no failures, `1` means at least one; `--json` prints the report itself, for a script (and nothing
else on stdout). It works when `jig.json` is invalid or a plugin fails to load: that is a failure line in the report, not
a crash, because that is exactly when you need it. If Jig is not installed in Pi, or Pi itself is not found, the machine
group has a failure with the command to install it: the doctor does not give an all-clear for a Jig Pi will not load.
Two copies with different versions are a warning.

**Getting the command.** Pi's `pi install` copies a package but does not link programs. Install Jig with npm, which
does: `npm install -g @clawdbuilder/jig` puts `jig` on your PATH (the same folder as `node` and `npm`), on Linux, WSL and
macOS. Add `@0.4.0` to install a release rather than the latest. For a checkout,
`npm install -g --install-links <checkout>` does the same from the folder, and `npm link` inside it is for development.
Setup never edits your shell files.

The command runs from `node_modules`, where Node will not strip TypeScript itself: its first line installs a small loader
that does, so the installed copy behaves like a checkout. If `jig` cannot find Pi, it says so with the folder to set in
`PI_HOST_DIR`.

## Setting up

```text
jig setup
```

It starts with the company question: which installed company setup you use, or "None, just me", and for which folders
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
in it. Without a terminal it refuses in one line and writes nothing; the doctor still runs. Exit code `0` is done or
nothing to do, `1` failed, `130` cancelled.

If your settings file is a link, as a dotfiles setup often makes it, setup follows the link, says which file it
will change, and writes that file. The link stays a link. A link that points nowhere, or to a folder, is refused
and nothing changes.

## This folder's Pi packages, and trust

Project packages (the `packages` in `<folder>/.pi/settings.json`, cloned under `<folder>/.pi/git`) are code, and Pi loads
them only after you trust the folder. `jig doctor` and `jig setup` follow the same rule: they read the folder's settings
and package folders for facts, but they import and run nothing from project scope until Pi's own saved decision in the
agent folder's `trust.json` says yes, or the agent folder's settings say `defaultProjectTrust: "always"`. A closer "do not
trust" wins over a parent's trust; a missing, unreadable or malformed `trust.json` fails closed. The doctor then shows a
`skip` line naming what was not loaded and how to trust the folder in Pi; setup says the same instead of asking questions.
User-scope packages are unaffected. Pi's `project_trust` extension event is not imitated: there is no screen for it here,
and loading less is the safe direction.

## The four words

| Word | What it means |
|---|---|
| `ok` | This works. |
| `warn` | This works, but something is worth knowing. |
| `fail` | A tool that needs this will fail. |
| `skip` | This was not checked, or does not apply here. |

Each `warn` and `fail` has a `fix:` line under it. The fix is a command or an action for you; Jig does not run it.

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
- It never signs in, unlocks a store, or refreshes a login.
- The doctor never changes `jig.json`; setup writes only the fields you confirm, and never rules, protected
  paths or the list of stores you turned off.
- It never installs a program or runs a fix.
- It never contacts a host without `--network`.

The checks in detail are in [Configuration](../plugins/jig-core/docs/configuration.md#the-jig-commands). Where a reference comes from is in
[Secrets](secrets.md#later).

For 0.4.2, install the npm package `@clawdbuilder/jig@0.4.2`; the tarball is checked with the npm versions CI uses. The
doctor checks the sandbox broker, the built-in roles folder and every Jig copy Pi loads.

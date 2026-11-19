# Your first hour with Jig

This page takes you from nothing to a Pi session that Jig governs: you install it, set up one plugin, answer
your first approval, check the sandbox and look back at what happened. It needs about an hour, and no
programming.

Each step says what to type and what you should see. If a step does not match, the page for that plugin has
the detail, and `/jig` always says what is wrong with your setup.

## 0. Before you start

You need:
- **Pi 1.4 or later** (tested with 1.5; see [Compatibility](compatibility.md)) and **Node.js 22.19 or later**;
- **git**, and a scratch repository to practise in (a new folder with `git init` and one commit is enough);
- **`gh`** (GitHub's command line) signed in with `gh auth login`, only if you want to try a pull request later.
  Jig never signs in; [Credential sources](../plugins/jig-core/docs/sign-in-and-transports.md) has who owns each login.

On Linux or WSL2 the sandbox also needs three programs. Install them now, so step 5 passes:

```bash
sudo apt install bubblewrap socat ripgrep
```

## 1. Install

```bash
npx @clawdbuilder/jig setup
```

This makes the Jig home (`~/.jig`), installs every plugin into it with Pi, and writes the `jig` command. Your own
`pi` is not changed: `jig` is Pi for the home. [`jig-core`](../plugins/jig-core/README.md) is the one that governs
the others, so it must always be loaded. To load only some plugins, see [Install](../README.md#install).

## 1b. Sign in to a model provider

Before the first session, sign in once: type `/login` inside `jig` to choose one, or run `jig auth login <provider>` in a
terminal. Jig never asks for the key; Pi stores it in the home's `auth.json`.

## 2. Run `/jig`

Start Jig in your scratch repository and type:

```text
/jig
```

You should see the tools Jig governs, whether `bash` is sandboxed, the plugins loaded, and a line about your
configuration. There is no `jig.json` yet, so it says `Configuration: none found ... defaults apply`, and each
plugin section reads `not set or invalid`. That is fine: the defaults are safe, and `/jig` is where problems
show up as you change things.

Three more commands help you look around:
- [/jig doctor](setup-and-doctor.md) checks the setup and says, in plain words, what is missing and what to run;
- `/jig rules` shows the decision for every tool and action, and where it came from;
- `/jig records` shows where today's records are.

From a terminal, `jig doctor` reads the same setup without starting Pi:

```text
Jig doctor · 12 ok · 1 warning · 0 failures · 11 skipped

This machine
  ok Node.js — 26.13.0 (Jig needs 22.19.0 or later)
  ok Pi — 1.5.2
  ok Jig — 0.5.10
…
Nothing is blocked. 1 warning is worth a look.
```

## 3. Set up one plugin: `jig-git`

Jig reads one file, `~/.jig/jig.json`. Run `jig setup` in a terminal; [Setup and doctor](../docs/setup-and-doctor.md)
covers the questions, confirmation and backup.

Jig loads no company plugin here, so `jig setup` asks git's own questions: pick **Git** in the list, or run
`jig setup git`, and answer the `gh` login and which account to use for a set of repositories. The rest of the
section is written by hand; this page shows the file's shape, with the branch new work starts from and the branches
the tools will not change directly:

```json
{
  "git": {
    "base": "main",
    "protected": ["main", "release/*"]
  }
}
```

Run `/reload`, then `/jig` again. It should now say `git (loaded)`. A typo in a field name is reported under
`Configuration problems` with the key at fault, and the plugin then does nothing until you fix it.

The other fields (patterns for branch names, commit messages and pull request titles, for example) are in
[jig-git's Configure table](../plugins/jig-git/README.md#configure).

## 4. Your first approval

Ask the agent for something small in your scratch repository, for example: *"Add a line to `notes.txt`, then throw
the change away with `git restore`."*

Two different things happen:
- **Editing the file just runs.** It changes only your project, so the rules allow it without asking.
- **`git restore` stops and asks.** It only touches your machine, but it destroys work that was not committed, so the
  tool declared it as a call that asks. The question shows the paths it would discard.

You can answer:
- **allow** this one call;
- **allow for this session,** so the same kind of call does not ask again until Pi closes;
- **decline,** and type a reason, which the agent reads.

A long preview opens as a scrollable screen instead of a one-line question. There, `y` allows, `s` allows for the
session, `n` or Esc declines, and `o` opens the preview rendered in your browser. The browser only shows; the answer
is always given in Pi.

Try declining once, with a reason, and watch the agent adjust. Then run `/jig rules git` to see why `restore` asks
and `status` does not. If your repository has a remote, `git push` asks the same way, and shows the commits it would
send. The reasoning is in [Permissions](permissions.md), and the rule about where answers happen is in
[Approvals](approvals.md).

## 5. Check the sandbox

The agent's `bash` commands run in a sandbox that hides your credentials (SSH keys, cloud logins, tokens)
and stops anything from planting code that would run later outside it. Prove it works on your machine:

```text
/sandbox doctor
```

The doctor checks each requirement and then runs real commands in the sandbox: a write, a read that must be
hidden, a name lookup and a connection to `localhost`. Each check that fails says what to do. On Ubuntu 24.04
the usual fix is the `sysctl` line in the [sandbox install notes](../plugins/jig-sandbox/README.md#install).

If the sandbox cannot start, `bash` is refused with the steps to fix it. It never runs unsandboxed by
accident. `/sandbox` alone lists every rule and where it came from.

## 6. Look back with `/lens`

After your session, type:

```text
/lens
```

It shows today and this session: the cost, the tool calls that failed, the questions you answered and how
long you waited for them. Nothing leaves your machine. [jig-lens](../plugins/jig-lens/README.md) explains
every line, and how to open a dashboard if you want one.

## 7. Where to read next

You now have seen the three ideas Jig is made of: rules decide, you approve inside the waiting call, and
everything is recorded. To learn how they are built:

1. **The concepts, in order.** The main README has a [reading list](reading.md):
   [Architecture](architecture.md), [Permissions](permissions.md), [Approvals](approvals.md) and
   [Secrets](secrets.md) first. The [glossary](glossary.md) explains the words.
2. **A plugin's README.** Each one is the specification its code follows, in the same shape. Start with
   [jig-core](../plugins/jig-core/README.md).
3. **The code, with a map.** The big plugins each have a code map: a table of every file with what it does
   and who calls it, and one real call traced through the files.
   - [jig-core](../plugins/jig-core/docs/code-map.md): one tool call through the gate
   - [jig-api](../plugins/jig-api/docs/code-map.md): running a saved request
   - [jig-ops](../plugins/jig-ops/docs/code-map.md): a deploy
   - [jig-sandbox](../plugins/jig-sandbox/docs/code-map.md): one `bash` command
   - [jig-agents](../plugins/jig-agents/docs/code-map.md): a child agent from start to report
   - [jig-workflow](../plugins/jig-workflow/docs/code-map.md): moving a ticket to the next stage

If you add to the docs or the code, [Writing the docs](writing.md) and the repository's
[AGENTS.md](../AGENTS.md) say how.

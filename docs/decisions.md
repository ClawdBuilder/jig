# Decisions

Dated so the reasons stay attached. Each entry says what was decided, and why.

## Contents

- [2026-11-04: `/jig doctor` reads, and `/jig setup` writes in the person's words](#2026-11-04-jig-doctor-reads-and-jig-setup-writes-in-the-persons-words)
- [2026-11-03: company profiles, and skill overlays instead of paired skills](#2026-11-03-company-profiles-and-skill-overlays-instead-of-paired-skills)
- [2026-11-03: deferred tools and stage tools](#2026-11-03-deferred-tools-and-stage-tools)
- [2026-11-02: the review screen's browser page is served over `localhost`, not opened as a file](#2026-11-02-the-review-screens-browser-page-is-served-over-localhost-not-opened-as-a-file)
- [2026-11-02: a Gradle build's tests pick an installed JDK that fits, from files](#2026-11-02-a-gradle-builds-tests-pick-an-installed-jdk-that-fits-from-files)
- [2026-11-02: the local packages and extensions that Pi loads are guarded paths](#2026-11-02-the-local-packages-and-extensions-that-pi-loads-are-guarded-paths)
- [2026-11-02: a push says how the agent will hear how the checks end](#2026-11-02-a-push-says-how-the-agent-will-hear-how-the-checks-end)
- [2026-11-02: a failed command is named when its output shows a Unix socket the sandbox does not make](#2026-11-02-a-failed-command-is-named-when-its-output-shows-a-unix-socket-the-sandbox-does-not-make)
- [2026-11-02: an environment can have its own CI job, and a `ci` call can name it](#2026-11-02-an-environment-can-have-its-own-ci-job-and-a-ci-call-can-name-it)
- [2026-11-02: Concourse is a CI system, its login is a secret reference, and a request can stop at a marker](#2026-11-02-concourse-is-a-ci-system-its-login-is-a-secret-reference-and-a-request-can-stop-at-a-marker)
- [2026-11-02: jig-git asks ssh which host an alias is](#2026-11-02-jig-git-asks-ssh-which-host-an-alias-is)
- [2026-11-02: a review of an agent run leaves out the commits that came in with it](#2026-11-02-a-review-of-an-agent-run-leaves-out-the-commits-that-came-in-with-it)
- [2026-11-02: start checks and the store unlock are the user's settings, run inside Pi](#2026-11-02-start-checks-and-the-store-unlock-are-the-users-settings-run-inside-pi)
- [2026-11-02: an optional launcher, with nothing a company decides](#2026-11-02-an-optional-launcher-with-nothing-a-company-decides)
- [2026-11-02: where the secret store is, and who types secrets](#2026-11-02-where-the-secret-store-is-and-who-types-secrets)
- [2026-11-01: guards a person would not see break](#2026-11-01-guards-a-person-would-not-see-break)
- [2026-11-01: a role only narrows, and the child enforces it](#2026-11-01-a-role-only-narrows-and-the-child-enforces-it)
- [2026-10-31: every dependency is on its latest stable release, pinned, and kept there by Dependabot](#2026-10-31-every-dependency-is-on-its-latest-stable-release-pinned-and-kept-there-by-dependabot)
- [2026-10-31: CI runs the latest and the previous line of every service, and MongoDB starts by a setting](#2026-10-31-ci-runs-the-latest-and-the-previous-line-of-every-service-and-mongodb-starts-by-a-setting)
- [2026-10-31: big files are split by job, big plugins have a code map, and growth is a warning](#2026-10-31-big-files-are-split-by-job-big-plugins-have-a-code-map-and-growth-is-a-warning)
- [2026-10-31: jig-workflow: test variables, tests outside the sandbox, and folders that add up](#2026-10-31-jig-workflow-test-variables-tests-outside-the-sandbox-and-folders-that-add-up)
- [2026-10-31: small gaps the example company plugin and later builds found, closed](#2026-10-31-small-gaps-the-example-company-plugin-and-later-builds-found-closed)
- [2026-10-31: jig-agents, as built](#2026-10-31-jig-agents-as-built)
- [2026-10-31: jig-git talks to GitLab through glab api, and the repository decides the forge](#2026-10-31-jig-git-talks-to-gitlab-through-glab-api-and-the-repository-decides-the-forge)
- [2026-10-31: jig-workflow, evidence and holds: a gate in jig-core, tests in the sandbox](#2026-10-31-jig-workflow-evidence-and-holds-a-gate-in-jig-core-tests-in-the-sandbox)
- [2026-10-31: an example company plugin, jig-acme, proves the generic plugins need no company code](#2026-10-31-an-example-company-plugin-jig-acme-proves-the-generic-plugins-need-no-company-code)
- [2026-10-31: production reads need an index, and pull request comments reach the agent](#2026-10-31-production-reads-need-an-index-and-pull-request-comments-reach-the-agent)
- [2026-10-31: jig-agents is built by us, on Pi's RPC mode](#2026-10-31-jig-agents-is-built-by-us-on-pis-rpc-mode)
- [2026-10-31: jig-memory cards and recall: the agent writes the prose, keys and keywords find it](#2026-10-31-jig-memory-cards-and-recall-the-agent-writes-the-prose-keys-and-keywords-find-it)
- [2026-10-31: jig-sandbox, background tasks and the network modes, as built](#2026-10-31-jig-sandbox-background-tasks-and-the-network-modes-as-built)
- [2026-10-31: jig-sandbox, as built](#2026-10-31-jig-sandbox-as-built)
- [2026-10-31: jig-sandbox, built on Anthropic's sandbox runtime](#2026-10-31-jig-sandbox-built-on-anthropics-sandbox-runtime)
- [2026-10-31: gaps a company plugin found in jig-core, closed](#2026-10-31-gaps-a-company-plugin-found-in-jig-core-closed)
- [2026-10-31: filter lists, Jira links and a pull request title rule](#2026-10-31-filter-lists-jira-links-and-a-pull-request-title-rule)
- [2026-10-30: Jig never signs in; it reads a credential and keeps it from the agent](#2026-10-30-jig-never-signs-in-it-reads-a-credential-and-keeps-it-from-the-agent)
- [2026-10-30: checks run on every push](#2026-10-30-checks-run-on-every-push)
- [2026-10-30: jig-theme, the look, built on Pi's own themes](#2026-10-30-jig-theme-the-look-built-on-pis-own-themes)
- [2026-10-30: reviews are approved in their page, and a passkey makes that unforgeable](#2026-10-30-reviews-are-approved-in-their-page-and-a-passkey-makes-that-unforgeable)
- [2026-10-30: jig-mongo is built on the official driver, with the walk of a pipeline as one of two locks](#2026-10-30-jig-mongo-is-built-on-the-official-driver-with-the-walk-of-a-pipeline-as-one-of-two-locks)
- [2026-10-30: jig-mongo is a complete MongoDB tool; no SQL tool for now](#2026-10-30-jig-mongo-is-a-complete-mongodb-tool-no-sql-tool-for-now)
- [2026-10-30: CI and its watches live in jig-ops, one adapter per CI system](#2026-10-30-ci-and-its-watches-live-in-jig-ops-one-adapter-per-ci-system)
- [2026-10-30: jig-api part 2: Bruno, OpenAPI and the Postman cloud, and the first dependency](#2026-10-30-jig-api-part-2-bruno-openapi-and-the-postman-cloud-and-the-first-dependency)
- [2026-10-30: jig-ops runtime and deploy, as built](#2026-10-30-jig-ops-runtime-and-deploy-as-built)
- [2026-10-30: jig-http becomes jig-api, and runs saved requests](#2026-10-30-jig-http-becomes-jig-api-and-runs-saved-requests)
- [2026-10-30: jig-ops, one plugin for build, deploy and run](#2026-10-30-jig-ops-one-plugin-for-build-deploy-and-run)
- [2026-10-30: jig-flow becomes jig-workflow, and workflows are named files](#2026-10-30-jig-flow-becomes-jig-workflow-and-workflows-are-named-files)
- [2026-10-30: no jig-scripts in the generic set](#2026-10-30-no-jig-scripts-in-the-generic-set)
- [2026-10-30: one tool manager over every tool](#2026-10-30-one-tool-manager-over-every-tool)
- [2026-10-30: jig-core is our own code, and it runs the watches](#2026-10-30-jig-core-is-our-own-code-and-it-runs-the-watches)
- [2026-10-30: a company's sign-in is a service, and its field names reach the masker](#2026-10-30-a-companys-sign-in-is-a-service-and-its-field-names-reach-the-masker)
- [2026-10-30, later: the lens, lighter](#2026-10-30-later-the-lens-lighter)
- [2026-10-30, later: the lens summary is an entry the model never reads](#2026-10-30-later-the-lens-summary-is-an-entry-the-model-never-reads)
- [2026-10-30: the lens reads a copy of the records](#2026-10-30-the-lens-reads-a-copy-of-the-records)
- [2026-10-30: how a watch tells the agent](#2026-10-30-how-a-watch-tells-the-agent)
- [2026-10-30: jig-git's tools, and a watch that knows when it is done](#2026-10-30-jig-gits-tools-and-a-watch-that-knows-when-it-is-done)
- [2026-10-30: built clean, beside the existing harness](#2026-10-30-built-clean-beside-the-existing-harness)
- [Earlier decisions that still hold (2026-10-29)](#earlier-decisions-that-still-hold-2026-10-29)

## 2026-11-06: Jig is published as a scoped npm package

The `jig` name on npm belongs to an unrelated 2013 package, so the product is published as **`@clawdbuilder/jig`**. The
command is still `jig`; npm's `bin` links it. The package is public, has a `files` allowlist (the command, every plugin,
the review page's built files, docs; no tests or local notes) and is published by the release workflow with provenance
from the same tag as the GitHub release. Pi installs the same artifact with `pi install npm:@clawdbuilder/jig@<version>`,
and a global CLI with `npm install -g @clawdbuilder/jig`.

An existing `git:` install keeps working: the CLI recognises a package named `jig` (the pre-scope name) as its own when it
came from git or a folder, while an `npm:` package must match the scoped name. The doctor and setup now print the npm
install line, and the docs lead with npm; the `git:` line remains for an unreleased checkout.

## 2026-11-05: project packages load only when Pi would trust the folder

`jig doctor` and `jig setup` read project packages from `<cwd>/.pi/settings.json` so a company installed for one project is
offered. But that meant importing code from any folder someone ran the command in, which is the same risk Pi's project
trust exists to stop: clone a hostile repository, run `jig doctor`, and its extension runs.

The command now applies Pi 1.5's rules itself, without importing Pi: the closest `true`/`false` in the agent folder's
`trust.json` from the canonical cwd upward decides (`null` does not); without one, only the agent folder's
`defaultProjectTrust` matters, and `"always"` is the only value that loads outside Pi's screen. A missing trust file is no saved
decision; a malformed or unreadable one fails closed. Project packages are still read as facts (settings, manifests), but `import()` and
factories wait for trust. The doctor shows a `skip` line naming what was skipped, and setup says the same rather than acting
as if there is no company; Jig listed only in an untrusted project is a skip, not "not installed". User-scope packages are
unchanged. The `project_trust` extension event is not imitated: there is no screen here, and under-loading is safe.

## 2026-11-05: action names are snake_case

Function-calling tools and MCP name actions `get_weather` and `create_pull_request`; a hyphen is not a letter in most
languages that write scripts against a schema. Jig's actions now follow that: `run_folder`, `postman_environments`,
`index_stats`, `create_index`, `drop_index`, `save_evidence`, `add_check`, `list_checks`, `close_check`, `submit_plan`.

Tool names, slash commands, `jig.json` keys, CLI words and workflow condition names are unchanged: the first three are
vocabularies people type by hand or already wrote, and the last is a file format, not a tool action.

Renaming a public name is breaking ([Compatibility](compatibility.md)). The safety-sensitive half is a rule that denies or
asks: if an old action name stopped matching silently, the rule would no longer apply. So the old names keep matching
through 0.4.x, in three places where a person wrote them: rules and classification rules (`jig-core`), a role's `actions`
and `ask` lists (agent file and `jig-agents` settings), and a workflow hold's action. `/jig` and `jig doctor` name every old
name they find, with the new one, and say it stops applying in 0.5.0. 0.5.0 removes the aliases, which is a second, dated
break; by then the notices have been in every release since 0.4.0.

The pinned audit table, the READMEs, the skills, the overlays and the tests use
the new names; nothing matches an action by a hard-coded old string.

## 2026-11-04: setup and doctor run as a standalone command

Setup and doctor are needed on the first day, often before Pi starts and always when Pi cannot: a broken `jig.json`, a
plugin that fails to load, no model yet. Running them only inside Pi made `/jig setup` say "nothing needs you" for the
person it is for (company defaults need a `profiles` entry a newcomer cannot know), hid the questions behind Pi's
dialogs, and tied the report to a session.

`jig doctor` and `jig setup` therefore run in a terminal with no Pi session. They load the same packages Pi would load
(agent folder, `settings.json` packages, the plugins' factories into a small headless host), then use the same doctor
checks, setup plan, write gate and probes; Pi's `/jig doctor` is a shortcut through that code, and `/jig setup` prints
one line telling you to run the command. The headless host registers sections and defaults and never starts a tool, a
session, a watch, a tunnel or a sign-in. A plugin that fails at load is a failure line in the report, never a crash.
Setup starts with the company question and writes the `profiles`/`profile` entry itself. Without a terminal it refuses
and writes nothing. Exit codes: doctor 0/1, setup 0/1/130.

The command comes from npm's `bin` (`npm install -g @clawdbuilder/jig`, and before the scoped package
`npm install -g --allow-git=root github:ClawdBuilder/jig`) links it beside `node` on
Linux, WSL and macOS. `--allow-git=root` is needed because npm 12 turns git and remote installs off by default; a release
is pinned with `#v0.4.0`. `pi install` does not link programs, so the docs say that plainly instead of editing anyone's
shell files. Inside Pi, an unknown or
unreadable Pi version is now a skip rather than a warning, and a secret store that no reference uses is not checked.

## 2026-11-04: `/jig doctor` reads, and `/jig setup` writes in the person's words

`/jig doctor` and `/jig setup` are built. Both exist so a teammate who does not edit JSON can set Jig up,
with their own preferences and their own way of keeping credentials, over a company plugin's defaults.

**Decided**
- **`/jig doctor` is read-only.** It reports the machine, the settings and each plugin section, every secret
  reference, the login tools the settings use, the sandbox and the records folder, at `ok`, `warn`, `fail` or
  `skip`, with one plain fix per finding. It never resolves a reference, signs in, unlocks a store or writes a
  setting. A reference's status is metadata only: a `pass` entry file, an environment variable, a file's size.
- **`/jig setup` may write the person's `jig.json`**, and nothing else but a backup beside it. The person
  types the command, sees what will change, confirms once, and runs `/reload`. It is a slash command, not a
  tool, so the agent and the model cannot run it. It refuses an invalid file or one that changed while it was
  open, keeps a backup, and replaces the file in one atomic step.
- **Plain words first; JSON only on request.** Every screen says what the change means for the person, such
  as "Jira: your token will be read from 1Password (vault Work, item Jira, field token)" or "GitHub: you sign
  in with gh; nothing is stored". A reference such as `op://...` or `pass:...` appears only behind "Show the
  exact change", beside the JSON diff.
- **No value, ever.** Setup asks where a credential lives, never for the credential. It offers the stores
  this machine has, preselects the company's choice, and prints the store's own command to add a missing
  secret. It never signs in and never stores a value.
- **The person's file is theirs.** Setup writes only the fields they chose, leaves every other key and a
  company plugin's defaults alone, and never changes rules, protected paths or the floor.

**Why**
- A file that only an expert can edit is a setup step most of a team skips, and a skipped setup is a tool that
  fails later with a message about a reference. The doctor and the setup are how a person who does not read
  JSON gets to a working, safe session.
- The write is the one thing that could break the rule that an agent does not change its own rules. A command
  a person runs, which shows the change in their words and asks once, keeps the person in charge; a tool the
  model calls would not.

**Rejected**
- **A setup tool the model can call.** The model would be able to change its own rules, and a prompt could
  reach it.
- **A password field or panel in Jig.** It is still Jig taking a secret, which is the rule that does not move.
- **Rewriting the whole file from a template.** It would lose what Jig does not understand and make every
  write a review of the whole file instead of the three lines that changed.
- **A doctor with `--fix` in the first release.** A check that changes the thing it is checking is trusted
  less, and repair needs its own reversible, named actions.

## 2026-11-02: a failed command is named when its output shows a Unix socket the sandbox does not make

A `bash` test run died with a JVM attach error before any test ran. The sandbox makes no Unix socket, by design, and the agent
guessed that only by reasoning. The sandbox explained refusals it could see (a path, a refusal word) and nothing else.

**Decided**
- **A failed command's output is checked for a few tool messages** that mean "no Unix socket": JVM attach, Docker's CLI, and the
  socket errors of Python, Node, `socat`, `nc` and Go. A match adds one `[sandbox]` line that says the failure *looks like* the
  sandbox and gives the way on: `outside: true`, which asks the user.
- **Only after a command that exited with a code other than 0,** so a command that worked is never accused.
- **The messages are data** in `lists.ts`, small, and tested with the text the tools printed in the real sandbox.

**Why**
- A model that is not told the cause tries the same command again or changes the code under test. One line saves both.
- Matching a tool's wording is a guess, so the line says "looks like" and offers a way, which asks the user, not a rule.

**Rejected**
- **Telling the agent about every possible block up front.** The description is read on every call; a line after a failure is
  read only when it matters.
- **A long list of tools.** Each entry is another message to keep right. An entry is added when a real session needs it.

## 2026-11-02: an environment can have its own CI job, and a `ci` call can name it

A service has one build CI, but the jobs that deploy it differ by environment, and so may the CI system. A Concourse job per
environment is the case that asked for it; a Jenkins job that differs by environment is the same case.

**Decided**
- **`environments.<e>.job` is a `ci` entry,** for any system that can start a build (Concourse, Jenkins, GitLab). GitHub Actions has no
  trigger, so it is refused. An environment may have only a `job`.
- **Every `ci` action takes `environment`.** With it the call uses that job; without it, the service's `ci`.
- **A call that names an environment acts in it.** The job carries the environment's name, so the rules of that environment decide:
  reads are reads there, `trigger` and `rerun` are writes there, a test environment asks and production is denied before anyone is
  asked. `watch` stays a local write.
- **The environment is in the fingerprint and the preview.** The same job approved for one environment is not approved for another.
- **A job never starts a watch on a push,** and its watch says nothing about a commit: no `jig-ops:ci-finished`, no "artifact
  ready". A push means "a commit was built"; a deploy job does not say that.
- **A user's own `auth` for a job replaces the company's whole** (`services.*.environments.*.job.auth` joins the `replace` keys).

**Why**
- **The environment already decides the rules.** Deriving the environment of a call from the job keeps one mapping, as the catalog
  does for `deploy`.
- **A second tool or a second service entry per environment** would have repeated the repository, the artifact rules and the
  service's name, and a call could not say "staging" at all.

## 2026-11-02: Concourse is a CI system, its login is a secret reference, and a request can stop at a marker

Teams that deploy with Concourse start a job by hand, and read its builds, the way a Jenkins team does. `ci` gains an adapter for it.

**Decided**
- **`concourse` is the fourth CI system** of `jig-ops`: `status`, `runs`, `run`, `log`, `trigger` and `watch`, with no `rerun`. The
  catalog names the team, the pipeline and the job; a call names none of them. `trigger` has no `ref` and no `parameters`, because a job
  runs what its pipeline pins. A paused job or pipeline is refused before anyone is asked.
- **Every build read is checked to be the catalog's.** Its team, pipeline and job must match, so a number cannot reach another job.
- **The login is a secret reference, sent as a bearer.** `fly login` writes a token for the person; a command the company declares
  prints only that token, and the entry says `{ "token": "cmd:<name>" }`. Jig never signs in: no `fly login`, no browser, no
  `~/.flyrc` read by a plugin. When Concourse refuses the login, or the reference cannot be read, the message names the command in
  `signInHint`, for the user to run in their own terminal.
- **`HttpRequest.stopAt` is a stop marker.** Concourse writes an `end` event and then keeps the stream open until the client goes (read in
  its source). The request stops reading when the reply holds the marker and lets the connection go. The contract only grows.

**Why**
- **A broker or a `fly curl` transport was the alternative to a reference.** Both need a program of ours to hold a session. A reference
  is read again for each request, so the call after the user's login works, and `jig-core` keeps the value from the plugin.
- **Without a marker, `ci log` waits for the time limit** on a finished build, and every failed watch carries no log.

**Rejected**
- **A plugin that runs `fly login` on a 401.** It signs in for the user, which no plugin does.
- **A `file:` selector in `jig-core`** for the token in `~/.flyrc`. A company's reader command does the same with no new backend.

## 2026-11-02: jig-git asks ssh which host an alias is

**Decided**
- **For an ssh origin, the real host comes from `ssh -G <host>`.** An origin in the scp-like form (`user@host:path`) or `ssh://` names
  a host that may be an alias in the user's `~/.ssh/config`. `jig-git` runs `ssh -G` on it through `jig-core`'s `exec.run` (3 seconds,
  no input) and reads the `hostname` line. `-G` only parses the configuration and never connects. An https origin is not asked.
- **The answer decides the forge and the host.** github.com and `ssh.github.com` are GitHub, gitlab.com and `altssh.gitlab.com` are
  GitLab, and the host `gh` or `glab` is told is that real host. An alias that ssh maps to github.com works with no `git.forges`
  entry, whatever its name.
- **`git.forges` keeps what it can do that ssh cannot.** An object-form entry (`{ "forge": ..., "host": ... }`) wins over ssh. A
  string-form entry decides the forge, and the host comes from ssh's answer. An entry is found by the host in `origin` or by the real
  host, so a self-hosted GitLab is named once, whatever alias reaches it.
- **When ssh cannot answer** (not installed, failing, too slow, or no `hostname` line) the convention applies, as it did before:
  `github.com-<alias>` and `ssh.github.com` are github.com, `altssh.gitlab.com` is gitlab.com. Nothing alarming is said.
- **One answer per host for the session,** and a failure is believed for a minute. One helper, `originHost`, serves `githubRepo` and
  `forgeOf`, so the two cannot disagree.

**Why**
- A company config named an alias in the string form, `"github.com-myteam": "github"`. `gh` was then told the alias as `GH_HOST`, and
  failed with "error connecting to github.com-myteam; check your internet connection", which the agent reported as GitHub being down.
- The alias lives in the user's own `~/.ssh/config`. Naming it again in `jig.json`, in a company plugin or by hand, repeats a fact that
  ssh already holds and that drifts from it.

**Rejected**
- **Only the `github.com-<alias>` convention in the string form.** It fixes the incident but still leaves every other alias to be
  named in `jig.json`.
- **Reading `~/.ssh/config` ourselves.** `Include`, `Match` and tokens make the file hard to read right, and ssh already does it.

## 2026-11-02: a review of an agent run leaves out the commits that came in with it

**Decided**
- **The offered review starts from a base that already holds what came in.** When a run merged, pulled, fast-forwarded, reset to a ref or
  rebased onto other commits, `jig-review` diffs the working tree against the run's starting commit merged with those commits by git's
  own automatic merge (`git merge-tree --write-tree`, git 2.38 or newer). A clean merge leaves nothing; a conflict leaves its markers in the
  base, so the agent's resolution is the difference. The agent's own commits and uncommitted edits show as before, and `--touched` follows
  the offer.
- **The agent's commits are the ones HEAD's reflog says git created in the run** (`commit`, `cherry-pick`, `revert`, `am`, a rebase's
  picks). Any other commit under a merge's other parent, or under where a fast-forward, pull, reset or rebase moved HEAD, and with
  none of the agent's under it, came in from elsewhere.
- **Nothing left means no offer, and one line says why:** `Nothing to review: the run only merged origin/develop.`
- **An explicit scope is unchanged.** `--branch`, `--staged`, `--unstaged`, a folder and a ticket show everything: you asked for it.
- **When git cannot tell** (older git, a reflog that is off or expired, a very long run) the review starts at the starting commit, as before:
  more than the agent did, never less. See [What counts as the agent's](../plugins/jig-review/docs/run-changes.md).

**Why**
- A clean merge of the main branch into a feature branch offered its colleagues' files as "the agent's changes". The user was asked to
  review and approve code the agent never wrote, which makes an approval mean less.
- A diff against a base that holds the incoming commits keeps the lines of a file the agent edited after the merge, and drops the lines
  the merge brought.

**Rejected**
- **Commits reachable from the upstream branch are not the agent's.** A push makes the agent's own commit reachable from it, and its
  review would vanish.
- **Commit dates.** A rebase and a cherry-pick keep the author date, an amend keeps it too, and two machines' clocks differ.
- **Taking merge commits only.** A fast-forward and a rebase have no merge commit.
- **Taking the incoming files off the list.** A file the merge changed and the agent then edited would drop out whole.

## 2026-11-03: company profiles, and skill overlays instead of paired skills

A company plugin added its own skill next to each generic one (`acme-jira` beside `jira`). Two descriptions were always in the
context for one trigger, and the company's rules were read only if the model also loaded the second skill. And a person can work for
more than one company, while only one company's setup should apply to the work at hand.

**Decided**
- **Profiles.** `profiles` in `jig.json` names profiles, each pointing at a company plugin with `when.folders` and `when.remotes`;
  `profile` is `auto` (the default), `none` or a name. A company plugin registers with `profiles.register(name, options)` and gives
  its parts through the view that returns. `/profile` shows the choice and why, and `/profile <name>` makes one for the session.
- **The choice** is the session's `/profile`, then `profile` in the file, then `auto` (first matching profile), then, only when there
  is no `profiles` section and one company plugin, that company. Nothing else is guessed: no match means no company.
- **Dormant** means environments, rules, classification rules, section defaults, secret commands and backends, status lines, skills and
  overlays do not apply. Protected paths and mask fields still apply, because they can only protect. A plugin that never registers
  applies always, so existing company plugins and users are unchanged.
- **Overlays.** A company plugin ships `overlays/<skill>.md` (plain Markdown, no front matter). For the active company jig-core writes
  `<state>/skills/<profile>/<skill>/SKILL.md`, the generic file unchanged plus a `## <Company> rules` section, with the skill's other
  files copied beside it, and points the skill in each turn's list (`before_agent_start`, `systemPromptOptions.skills`) at that file.

**Why**
- **One description per trigger.** The model sees the generic description once, and the context no longer holds a pair.
- **The rules are always read.** They are in the file the model opens for the generic skill, so they cannot be skipped.
- **A single source of truth.** The generic skill is read from where it is and never copied by hand, so a change in Jig reaches the
  merged copy at the next start, and the company file holds only what is the company's.
- **Safety with several employers.** A dormant company's production names must not count as test, and its allow rules must not weaken
  another company's work. Making dormancy a rule of the API, not each plugin's care, keeps that true.

**Rejected**
- **Keeping paired skills.** It is the cost above, and a company skill that is not loaded is silently missing.
- **Editing the generic skill's file, or Pi's skill objects, in place.** The file belongs to a package that is not ours, and Pi's
  objects are shared; a merged copy under the state folder and a new list per turn change neither.
- **Choosing by an environment variable or a flag.** The working folder and the git remote are what already tell the work apart.
- **Falling back to a sole company when profiles are configured.** Writing profiles says where each company applies; an unmatched
  folder is the case the profile is for.

## 2026-11-03: deferred tools and stage tools

Every Jig tool's description is sent at session start, about 13k tokens with all the plugins loaded, though most sessions use a
few of the tools. Pi 1.5 can register a tool `deferred`: it is not declared to the model until Pi's `tool_search` finds it.

**Decided**
- **`tools.deferred` in `jig.json`** names the Jig tools to defer. jig-core checks the section like a plugin's, so a company
  plugin can give a default through `addSectionDefaults("tools", ...)`, and the user's list replaces it. A name no plugin
  declared is a warning at session start, said once; Pi's own tools (`read`, `bash`, `edit`, `write` and the rest) are refused.
- **Every plugin registers through `registerJigTool`** (kit), a drop-in for `pi.registerTool`. A plugin registers before
  `jig.json` is read, so the tool is registered direct, and at session start a deferred one is registered again as
  `deferred` and taken out of the active set, unless the transcript shows it loaded (a resume or a reload keeps it).
- **jig-core activates `tool_search`** at session start when a Jig tool is deferred, as Pi's MCP extension does for deferred
  servers (Pi registers it inactive). Without a `tool_search`, nothing is deferred and the user is told.
- **A workflow stage can name tools** (`"tools": ["deploy"]`). jig-workflow activates them when the work enters the stage and
  takes out, when it leaves, only those it added, and never one the user switched on meanwhile (`jig-session`'s switches).
  What it added is kept in a session entry, so a reload or a resume knows which tools are the stage's.

**Why**
- **Context and focus, more than money.** Prompt caching makes the repeated descriptions cheap after the first request, so the
  saving in money is small. The gain is a smaller context and fewer tools for the model to weigh on every turn.
- **The safety net is Pi's.** `tool_search` finds a deferred tool by its name and description, so a task that needs one still
  gets it, at the cost of one extra step. A stage that knows it needs a tool brings it in without that step.

**Rejected**
- **Deciding the exposure when the plugin loads.** A company plugin's defaults may come after the plugin, and `jig.json` is read
  at session start; a tool registered once with the wrong exposure would have to be changed anyway.
- **Hiding the tools a stage does not name.** A stage says what it needs, not everything it may need; `tool_search` covers the rest.
- **A loader tool of our own.** Pi ships one; a second would be another description in every session.

## 2026-11-02: the review screen's browser page is served over `localhost`, not opened as a file

The `o` key wrote the page under the state folder and started the browser with a `file:///home/...` address. A Windows
browser started from Linux under WSL cannot open a Linux path, so nothing opened, and Jig still said "opened in the browser"
because the launcher had started. A `\\wsl.localhost\...` address stalls on a network-file security prompt.

**Decided**
- **The page is served by a small server in `jig-core`,** on `127.0.0.1` and a random port, started by the first preview and
  closed when the session ends, and opened at `http://localhost:<port>/preview/<uuid>.html`, as `jig-review` opens its page.
- **It serves only pages `jig-core` wrote,** each at an unguessable path; GET and HEAD only; any other path is a 404, and a
  Host that is not this server's is a 403 (DNS rebinding). The headers are `no-store`, `nosniff`, `no-referrer` and the page's
  own policy plus `frame-ancestors 'none'`.
- **The pages are kept in memory (the latest 50),** not written to disk, while the server works. The file under `previews/`
  is the fallback only, used when the server cannot listen, and the status line says which was used.
- **A file address is never tried under WSL, or when the opener is a Windows program** (an `.exe`, or a path under
  `/mnt/<drive>/`). WSL is found by `/proc/sys/fs/binfmt_misc/WSLInterop` or "microsoft" in `/proc/version`, not by
  `WSL_DISTRO_NAME`, which a shell started over SSH lacks. Opened that way, the file raised a Windows network-file security
  warning every time, so the screen reports the server's failure and leaves y, s and n.
- **The line says what is known:** the address that was opened, or why it could not be, with the address to paste. A
  launcher that starts proves nothing about what the browser did.
- **`approvals.openInBrowser`** (`"on-key"` by default, or `"always"`) opens the page once as a review screen appears.

**Why**
- An address on `localhost` is the one thing both sides of WSL can reach, and it works the same on every platform.
- The server has no route that takes input, so the rule that approvals happen only inside the waiting call is unchanged: it
  is not an approval endpoint. A random path alone is not relied on, because the agent's shell shares this machine's network;
  the page holds what the user is about to approve, which the agent already knows, and nothing else.
- Keeping the pages out of the state folder leaves less of a plan on disk.

## 2026-11-02: a Gradle build's tests pick an installed JDK that fits, from files

A test run used a `JAVA_HOME` from a stale document, a JDK patch release that was no longer installed, and Gradle 2 to 7 cannot run
on the machine's default Java 21. `workflow.tests` could only fix it with an `env.JAVA_HOME` that each user wrote for each repository.

**Decided**
- **A test command that runs a Gradle wrapper gets an installed JDK that fits,** when no `env.JAVA_HOME` is set. The wrapper's
  Gradle version, the build's stated Java level and Gradle's compatibility table decide; `env.JAVA_HOME` still wins.
- **Everything is read from files and nothing is run.** The JDKs are found in the usual places and read from their `release` file.
- **With a level stated, the lowest Java that fits; with none, a default that Gradle runs on stays,** and otherwise the newest.
- **When none fits the repository is not run,** and the line says what is needed and which JDKs were found.

**Why**
- Starting an unsuitable build wastes a long run on an error about class file versions that sends the agent after the wrong cause.
- The table is Gradle's own and small, so a wrong Java is a data fix. A wrong guess costs one line that says what was chosen.
- A level nobody stated is more likely too low than too high: a build with no `sourceCompatibility` runs on whatever Java starts it.

**Rejected**
- **Running `java -version`** on each folder: slower, and it runs code from folders the agent may be able to write.
- **Choosing for builds that are not a Gradle wrapper.** Maven and `gradle test` have no pinned version to decide from.

## 2026-11-02: the local packages and extensions that Pi loads are guarded paths

Pi loads the local packages that its settings list, and runs their code with no sandbox, at the next start. When such a folder
sits in the working folder, a sandboxed `bash` (which may write the working folder) could change that code: an escape. The sandbox
locked Node.js, Pi's own folders and the agent folder, and not these.

**Decided**
- **`jig-core` adds them to its default protected paths as `guarded`,** so Pi's file tools refuse to write them and the sandbox,
  which locks every guarded path, locks them for `bash`. Each says what named it: `(a package in settings.json)`.
- **They are read from Pi's settings the way Pi reads them:** the agent folder's `settings.json` and `.pi/settings.json` of the
  working folder, a relative path starting from the agent folder and from `.pi`. The plain `extensions` entries count too, since
  they run the same way. A `git:` or `npm:` package of the user's lives in the agent folder, already guarded.
- **The extension files Pi loaded are added when Pi lists them,** from the tools and commands they registered. One that registered
  neither is not listed by Pi, so it is not guarded.
- **A path is guarded whether or not it exists yet,** since a file made there before the next start would be loaded.

**Why**
- The guard follows what Pi will run, so a new package is covered without a rule for each repository.
- One list for the file tools and `bash` means they cannot disagree.

**Rejected**
- **Locking them in `jig-sandbox` only.** Pi's file tools could still change the code, and the two lists would drift.
- **Skipping a package that holds the working folder.** It would leave the escape open for the one setup where it matters most.
  The folder becomes unwritable instead, which is loud, and the user changes it with `!`.

## 2026-11-02: a push says how the agent will hear how the checks end

After a push the agent said "I'll look at the CI result once it runs" and ended its turn, with nothing that would wake it.

**Decided**
- **The result of a push ends with one line.** When a listener started a watch while the push was announced, the line names it. When
  none did, it says what starts one and that the user has to ask otherwise. A push that was not announced gets no line.
- **The way to start one is the `ci` tool's `watch` action,** not `pr watch`: `pr watch` reports new comments, and never checks.
  The line says so, so that a model does not wait for checks on a watch that cannot report them.
- **A started watch is found by what `jig-core` lists,** open after the event and not before. `jig-git` still does not know
  `jig-ops` or whether it is installed.
- **One sentence in the tool guidance and the skill** says that a promise to report later needs a watch.

**Why**
- The agent can hold only what it is told. A line at the moment of the push is read when it matters.
- Starting a CI watch from `jig-git` would put CI back into it, after CI moved to `jig-ops` so that each system has one adapter.

**Rejected**
- **Naming `pr watch` as the way to hear about checks.** It would send the agent to wait on a watch that never reports them.

## 2026-11-02: start checks and the store unlock are the user's settings, run inside Pi

**Decided**
- **Two start-up jobs are settings in the user's `jig.json`.** `startChecks` lists TCP checks, and
  `secrets.pass.unlockAtStart` asks for the pass store to be unlocked. `jig-core` runs both inside Pi when a session
  starts, so they work however Pi was started: from a terminal, a launcher, a shortcut or an IDE.
- **A start check is one TCP connection and nothing else.** Each check connects to its host and port and closes at
  once, with a limit of 3 seconds. The checks run in parallel, none is retried, nothing is sent, and nothing is
  started, stopped or signed in to. A failure is one notice for the user, with the check's own hint.
- **The unlock opens one entry through the secret resolver.** Jig finds one `*.gpg` entry in the store `pass` uses and
  has `pass` decrypt it, in turn with the other lookups, so a tool that asks meanwhile waits for it and finds the
  store open. gpg-agent shows its own prompt, and Jig never asks for, sees or keeps the passphrase. It drops the value at
  once and does not register it with the redactor.
- **Both run only in the top-level session with a screen.** There is nobody to tell in print mode, and a child agent is
  one of many that a parent started. `jig-agents` marks a child with `PI_SUBAGENT_ID`, and that is the signal used.
- **They run in the background and tell the user, never the model.** The session start does not wait for them and
  cannot fail on them. A notice never holds a value, an entry name or what `pass` printed.
- **`startChecks` is `jig-core`'s own section,** like `rules`, so only the user's file can set it. `/jig` lists the checks
  with their last result.

**Why**
- A launcher script runs only when Pi is started through it. A check or an unlock kept there disappears when Pi starts
  another way, and the user is left to find out why. It is the reasoning that put the store folder in `jig.json`.
- Which hosts must answer, and whether a store is unlocked, are facts about one user's machine and network. They are the
  user's to write down, not a script's to decide.
- A passphrase prompt in the middle of a task interrupts it and is easy to miss. At the start of a session the user is
  there to answer it.
- Telling the user costs nothing, and doing more would not be Jig's place. The VPN client and the password store each
  have an owner, and a tool that needs the host or the store still fails with a clear error.

**Rejected**
- **A launcher script that hard-codes a company host or unlocks a store.** It decides for the user, and it is skipped when
  Pi starts another way.
- **A company plugin adding start checks.** It would decide which hosts a user's machine probes. A company plugin can
  neither register a `startChecks` section nor give it defaults.
- **Retrying, or acting on a failed check.** A retry turns one notice into traffic and delay. Starting a VPN or signing
  in to anything would be control of software that Jig has no business with. The user reads the notice and fixes it.

## 2026-11-02: an optional launcher, with nothing a company decides

A user who wants Pi to survive a closed terminal window needed a `pi` command that starts it inside tmux. The one the author used also
checked a VPN, unlocked a password store and set a company's folders. This entry keeps the first part, in `bin/`, and drops the rest.

**Decided**
- **`bin/pi` is a launcher you may use, and Jig does not need it.** It finds Pi, repairs a dead WSL interop socket, starts an
  interactive session in its own tmux server (`-L jig`), and reattaches to a detached session started in the same folder. A print run
  or a subcommand goes straight to Pi.
- **It sets nothing of the user's.** No agent folder, no password store, no profile, no default. Pi's own defaults apply, and a
  personal shim at `~/.local/bin/pi` exports what a user wants and runs the launcher. It never signs in and never touches the network.
- **Pi inside tmux sees the environment of the terminal that started it.** Every exported variable is passed on except the ones that
  describe the terminal or the shell (`TERM`, `TMUX`, `SHLVL`, `PWD` and a few more). A variable an earlier terminal left in the tmux
  server, which this one does not set, is removed from the session.
- **The values travel in the tmux client's environment, and only names go on the command line.** tmux's `update-environment` setting
  copies the variables it names from the client's environment into a new session and removes those the client lacks, which does
  both halves of the rule above. The setting is put back to tmux's own list as soon as the session exists.

**Why**
- **A launcher that decides is a company plugin in disguise.** A VPN host, a password store and an agent folder are one company's
  choices. Nothing in this repository names a company ([AGENTS.md](../AGENTS.md)), and the launcher is no exception.
- **A warm start in a launcher only runs when the launcher does.** A Pi started from another tool, a script or an editor skipped it
  without a word. The same checks as settings of `jig.json` (`startChecks`, `secrets.pass.unlockAtStart`) run inside Pi, however
  Pi started, and the user's own file says what they are.
- **`tmux new-session -e NAME=value` puts every value in a command line.** Measured with tmux 3.4 on Linux: the value is in
  `/proc/<pid>/cmdline` of the tmux client for as long as the session is attached, readable by every other process of the machine.
  Passing every exported variable that way would have put cloud keys and tokens there.

**Rejected**
- **A warm start in the launcher** (a network probe, a password-store unlock). It is skipped when Pi starts another way, and it decided
  for the user what to check and what to unlock.
- **A list of variable prefixes to forward.** Every new tool needed an entry, and a missing one only showed as a setting that did not
  reach Pi inside tmux. "Everything except the terminal's own" has no list to keep up.
- **`-e NAME=value` for the variables,** and `env -u NAME` for the ones to remove, for the reason above. Names alone are safe on a
  command line.

## 2026-11-02: where the secret store is, and who types secrets

**Decided**
- **Where the store is, is a setting.** `secrets.pass.storeDir` and `secrets.pass.gnupgHome` in `jig.json` say where `pass`
  looks. They win over `PASSWORD_STORE_DIR` and `GNUPGHOME`, which win over `pass`'s own defaults, so the store no longer
  depends on how Pi was started. The two folders are protected paths with the setting: Pi's file tools refuse them and
  `jig-sandbox` hides them from `bash`.
- **A credential folder that an environment variable moves is protected too.** The built-in list knew `~/.password-store`,
  `~/.gnupg`, `~/.aws` and the like, so a store kept elsewhere through `PASSWORD_STORE_DIR`, `GNUPGHOME`, `AWS_CONFIG_FILE`,
  `AWS_SHARED_CREDENTIALS_FILE`, `KUBECONFIG`, `GH_CONFIG_DIR`, `GLAB_CONFIG_DIR`, `CLOUDSDK_CONFIG` or `DOCKER_CONFIG` was
  readable by the agent. Pi's environment is now read when the session starts, and an absolute (or `~/`) value becomes a
  secret path. The root, the home folder and a folder above it are never protected this way.
- **Other stores go through `cmd:`.** A backend is a program that `jig-core` runs, so any store with a command line works with
  one declared command per secret (gopass, Vault, AWS Secrets Manager, Azure Key Vault, the Linux Secret Service, Bitwarden).
  The pages say how ([Other stores](secrets.md#other-stores)).
- **A read-only status comes later.** For each reference a session's tools name, whether it is found, missing or behind a locked
  store, never a value ([Secrets](secrets.md#later)).

**Why**
- A security rule that depends on how a program was launched is a rule that fails quietly. The folder a store lives in is a fact
  about the user's machine, so it is written down once, and it is protected wherever it is.
- Each store already has a command line and an owner who keeps it up to date. Using it as it is costs Jig nothing and
  ties it to no store.
- Jig's rule is that you handle passwords: it never asks for one, takes one or keeps one.

**Rejected**
- **A store library as a `jig-core` dependency.** `pass` is a program, and a library for one store would tie Jig to that
  store and leave every other one out.
- **A password panel or prompt in Jig.** A secret typed into Jig's code, or into a terminal program's, passes through code that
  is not the store's own. You add secrets with your store's tool, in your own terminal.
- **A Windows Credential Manager backend, for now.** No standard command prints a stored password, so `cmd:` has nothing to run,
  and a backend would need code of its own to read the store.

## 2026-11-01: guards a person would not see break

Jig's tests could pass while four things were broken: a new Pi, a dependency that only a full checkout has, a renamed name that
company plugins use, and a plugin that reached into another's code. Each now has a test or a CI step, so nobody has to remember.

The ideas come from how Pi, Playwright, the MCP TypeScript SDK, OpenAI's Agents SDK and Codex, Gemini CLI, Strands, TokenEconomizer
and the Claude Agent SDK keep themselves honest. The code is ours.

- **A Pi canary.** CI is on one exact Pi and the peer range is `*`, so a Pi release can break Jig unseen. A weekly job (and a manual
  one) installs the newest Pi and runs the checks, the tests and the install check. It never runs on a pull request and is not
  required: red means "look at the new Pi". A "Tested with" table in the README and [Compatibility](compatibility.md) says what is
  tried, and a test keeps CI, both tables and `AGENTS.md` on the same Pi.
- **The install is tried the way a user gets it.** `pi install git:` installs `dependencies` only, so a plugin that imports a
  devDependency works in every test and fails for the first user. `npm run check:install` lets the stock Pi itself install a copy of
  the working tree (a git setting points a fake address at it) and requires every extension to load; `check-runtime-deps` is the
  static twin. Rejected: running `npm install --omit=dev` ourselves, which would drift from what Pi does.
- **The public surface is pinned by literals.** The handle, the `JigApi` members, the exports of the contract, client and kit, every
  tool and action, command and `jig.json` section, the record fields and the `JIG_*` variables. Adding is fine; removing or renaming
  needs an entry here first, and a contract break a new `version` ([Compatibility](compatibility.md)). Rejected: generating the
  expected lists from the code, because a pin that follows the code pins nothing.
- **A plugin imports `jig-core`'s contract, client and kit, and nothing else of another plugin.** Measured first: that was already
  true of every import, so there are no exceptions to list. The test names the file, the import and the rule.
- **Supply chain.** `.npmrc` writes exact versions and skips releases younger than 2 days (`min-release-age`, npm 11.10 and later: CI's
  npm has it, a lockfile install is not held back, and older npm only warns). CI uses `npm ci --ignore-scripts`, because no package
  in either lockfile has an install script. `npm run check` fails on a version that is not exact.
- **One name to require.** `ci-ok` needs every other job and fails unless all succeeded, so the Node matrix can change without
  touching branch protection; a test fails when a job is not in its `needs`. The checks job ends by requiring a clean working tree.
  actionlint runs from a pinned release whose checksum is checked, and not from a third-party action.
- **Tests start in a world of their own.** A temporary home, git configuration with a test identity, Pi agent and state folders, no
  cloud or forge credentials, Pi offline. CI no longer sets a global git identity; the tests bring theirs. The integration suites keep
  their `JIG_IT_*` variables, the GitHub token and the kubeconfig they name.

## 2026-11-01: a role only narrows, and the child enforces it

- **What was wrong.** A role narrowed by tool name only, and `writes: false` only checked the tool list. The shipped
  scout and reviewer therefore had the whole `git` tool, push included, and no `bash`, so they could not even run `rg`.
- **The rule, from Codex.** A role may customise its child or reduce what it can do, never widen it, and the **child**
  enforces it: not the parent, and not the prompt. The others compared (Claude Code, `pi-subagents`) let a file name whole
  tools and leave the rest to a permission layer; Jig has that layer in every child already, so it uses it
  ([Specialisation compared](../plugins/jig-agents/docs/options.md#specialisation-compared-2026-11-01)).
- **One environment variable carries it.** The parent writes the role's `writes`, `actions` and `ask` into `JIG_ROLE_POLICY`
  when it starts the child. In the child, `jig-agents` reads it once and registers a `jig-core` gate: writes are refused for
  `writes: false`, a tool named in `actions` runs only those actions, and an action in `ask` asks. A gate can only make a
  decision stricter, so the child's rules and the floor still apply. The model cannot give a running Pi another environment.
- **A policy that cannot be read fails closed,** through the path the start-up check already had: the child refuses every call
  and throws when its session starts, which the parent reads as a plugin that failed to load. `jig-core`'s kit holds the one
  parser that `jig-agents` and `jig-sandbox` both use, and `jig().tools.declared()` is the one small addition to the contract.
- **A read-only role may have `bash`, in a sandbox.** `jig-core` calls every `bash` a write. For a role that does not write,
  `jig-sandbox` locks the child's home folder and working folder, and the gate lets only a plain `bash` through while the
  sandbox is active. Where there is no sandbox the role is refused, so `scout` and `reviewer` need `jig-sandbox`.
- **The build caches are locked with the home folder,** because the runtime lays a read-only mount over the writable ones.
  That costs a read-only role the ability to build, and closes the route by which an agent changes a cache that a later
  build outside the sandbox uses. A role that must build is a writing role.
- **Configuration can narrow and never widen.** `writes` and `tools` are not settings. `actions` keeps the actions that both the
  file and configuration list, `ask` adds up (a company's and yours too), and the fields that only choose what a child reads replace
  the file's: `skills`, `preload`, `context`, `thinking`.
- **What a child reads follows its tools.** Without a `skills` line, a skill that belongs to a plugin is seen only by a role that
  has one of the plugin's tools. A company's skill says which tool it extends with `metadata: jig-tool:`, a field the Agent Skills
  format keeps for authors and Pi's parser accepts. `preload` puts a skill's whole text in the instructions, `context: none`
  leaves out AGENTS.md and CLAUDE.md, and `thinking` sets the level.
- **Left out:** a `memory` field, until a rule exists for what a child may remember and who may write it; `fetch` in the
  shipped read-only roles, because it changes the repository's remote refs; and a narrowing of the worker's `git`, since a push asks
  by default.

## 2026-10-31: every dependency is on its latest stable release, pinned, and kept there by Dependabot

- **Latest stable, exact pins.** All npm dependencies of the root and of the review page moved to their latest
  release, including TypeScript 7.0 (the native compiler), Vitest 5, Biome 2.6, `@types/node` 26 and
  `@anthropic-ai/sandbox-runtime` 0.0.81. No `^` or `~`: the lock file and `package.json` agree, and an upgrade is
  a visible change.
- **Dependabot keeps it there.** Weekly, patch and minor together in one PR, each major alone, with a cooldown of
  3 days (7 for a major) so a bad release is pulled before it reaches us. The sandbox runtime is its own PR.
- **What the upgrades forced.** TypeScript 7 removed `baseUrl` (the `paths` were already relative) and checks
  side-effect imports, so the review page loads `vite/client` types for its CSS imports. Biome 2.6 formats Markdown
  and YAML by default; both are turned off here, as they would rewrite most docs and the workflow file. Vitest 5
  and `@types/node` 26 needed nothing.
- **Sandbox runtime 0.0.81** was adopted 11 days after release, short of the two-week rule in the sandbox design
  doc, because its release notes list Windows-only changes. The doc records it.
- **Not held back:** nothing. TypeScript 7 works for both the plugins and the review page.

## 2026-10-31: CI runs the latest and the previous line of every service, and MongoDB starts by a setting

- **Two lines, not one.** The `integration` job runs the latest services (Elasticsearch 9, OpenSearch 3, MongoDB 9.0, Helm 4, Node 26) and the
  previous ones (Elasticsearch 8, OpenSearch 2, MongoDB 8.0, Helm 3, Node 24), because `jig-logs` claims both lines of each
  backend and people run both. The runs pair the versions and do not cross them: a full cross is four runs of up to 45
  minutes, for little more than the two pairs show. A failure that needs one combination is reproduced by hand.
- **MongoDB starts by a setting, not by an old version.** The job ran MongoDB 7.0 because 8.x exits at start-up on GitHub's kernels
  (6.19 to 7.0.x). Every member now sets `GLIBC_TUNABLES=glibc.pthread.rseq=1`, so TCMalloc uses per-thread caches and the start-up
  check passes on every kernel. The upstream fix only lifts the check from kernel 7.0.14, and Ubuntu names its 7.0 kernels
  `7.0.0-N`, so a newer image would not help. The set-up step asserts `tcmalloc.usingPerCPUCaches` is `false`, so an image that ignores
  the setting fails with a reason.
- **The images live in a compose file.** `.github/integration/compose.yml` and `previous/compose.yml` hold every image with its tag
  and digest, so Dependabot's `docker-compose` support updates them. The previous folder has its own Dependabot entry that holds
  its images to their line. The Kubernetes node image is a service that is never started, for the same reason.
- **Actions stay pinned by commit SHA** with the version in a comment. Node moves with the LTS schedule: the current line and the one before.

## 2026-10-31: big files are split by job, big plugins have a code map, and growth is a warning

The owner learns the system by reading it, so the shape of the code is part of the documentation. No behaviour changed in
this entry; it is about where things are.

- **Files are split by what they do, not by size.** Ten files of 590 to 870 lines were read for their natural parts and
  split where a part had one job: a family of actions, a way of reading a format, the process of a child, the questions it
  asks. Exported names and behaviour are the same, and the tests changed only in their imports. Each new file opens with a
  paragraph on what it does and why it is separate. The results:
  - `jig-agents`: `child.ts` 865 to 539 (with `child-process`, `child-questions`, `child-report`, `child-types`) and
    `runtime.ts` 618 to 480 (with `start-plan`, and `watch.ts` keeping which watch belongs to which child);
  - `jig-workflow`: `actions.ts` 773 to a list of five files of 100 to 220 lines, one for each family of actions;
  - `jig-api`: `openapi.ts` 749, `postman.ts` 716 and `bruno.ts` 692 to files of 60 to 270 lines;
  - `jig-git`: `git-local.ts` 686 to `git-branch`, `git-changes`, `git-integrate` and `git-guards`;
  - `jig-sandbox`: `sandbox.ts` 626 to 443 and `background/tasks.ts` 644 to 465;
  - `jig-review`: `coordinator.ts` 587 to 469, with `RunTracker` in `run-tracker.ts`.
- **A class that shares its private state is split only as far as its parts can stand alone.** `child.ts` is still the
  longest at 539 lines, because its start, its events, its limits and its end all work on the same fields. Splitting it
  further would mean exposing those fields, which is harder to follow than a long file with clear sections.
- **A code map for six plugins** (`jig-core`, `jig-api`, `jig-ops`, `jig-sandbox`, `jig-agents`, `jig-workflow`): a
  `docs/code-map.md` with every file, what it does and who calls it, grouped by layer, and one real call followed through
  the files. A test fails when a file of `src/` is missing from its map or a listed file is gone, so a map cannot rot. It
  does not check the "called by" cells; the code is the judge of those.
- **[Your first hour with Jig](first-hour.md)** is the page for a newcomer: install, `/jig`, one plugin, one approval, the
  sandbox doctor, `/lens`, and what to read next.
- **Size and complexity are warnings, never failures.** Biome's `noExcessiveCognitiveComplexity` is on as a warning at 40,
  which flags 29 functions today; Biome's own default of 15 would flag 287. A test prints a warning for every
  source file over 500 lines (13 today), and an annotation on the file in GitHub Actions. Lower the threshold as functions
  are simplified.
- **Rejected: a limit that fails the build.** A hard limit invites splitting to meet the number, and a bad split is worse
  than a long file. A warning keeps growth in sight and leaves the judgement to the person reading.
- **Left:** the files the size test lists, such as `jig-core`'s `config.ts` and `contract.ts`, which are the next
  candidates when someone has to change them.

## 2026-10-31: jig-workflow: test variables, tests outside the sandbox, and folders that add up

A company configuring `jig-workflow` found three gaps. Each is a commit of its own, with tests and docs. Nothing is specific to a company.

**Variables for one repository's tests**
- **`env` in a `workflow.tests` entry** sets plain variables, such as `JAVA_HOME` to pick a JDK. Which JDK a repository needs is a fact
  about the repository, so it belongs in the entry next to the command.
- **A command line sets them in the sandbox.** `sandbox.run` takes a command and nothing else, so the line is `export A=b && command`,
  with every value quoted. A run without a sandbox passes them as the shell's environment. Rejected: an `env` option on `sandbox.run`,
  which changes `jig-core` and `jig-sandbox` for what one line of shell does.
- **A name that looks like a credential is refused,** by the patterns `jig-sandbox` takes out of a command's environment. The list is
  copied, because a plugin does not import another's modules, and a test compares the two. A token does not belong in a plain file.
- **`~` is the home folder** at the start of a value and after a `:`. Nothing else is expanded, so `$HOME` stays text.

**Tests that need what the sandbox hides**
- **`outside: true` is configuration only.** The `workflow` tool has no such parameter, so the model cannot choose it.
- **It runs through `bash`'s own way to run outside.** The plugin calls `bash` with `outside: true` and a fixed reason through
  `ctx.executeTool`, as `bind` calls `git`. So `jig-core` asks in the waiting call, a rule that names the command can allow it, no
  screen means no, and `jig-sandbox` records the run. Rejected: a dialog of the plugin's own, which no rule could name and `/sandbox`
  would not list; an API that asks for a plugin, which is a second door for approvals; and a parameter for the model.
- **The line starts with `cd`,** because `bash` runs in Pi's folder and has no folder parameter.
- **A refusal is that repository's result,** and the others go on. A run that passed counts like a sandboxed one at the same HEAD, and
  `status` says where it ran. Without a sandbox that can run commands, nothing changes: the call asks once for every command.
- **The question shows the command, not the build files,** and the agent can edit those. The docs say to look at what changed first.
- **Not verified:** the tests use the real `jig-core` and `jig-sandbox`'s own declaration of `bash` with a stand-in for the tool. A real Pi
  with the real sandbox has not been tried, and the README says so.

**A company's folders and yours add up**
- **`registerSection` gets `union`,** the lists that add up: the company's entries first, then yours, each once. Only `jig-core` sees both
  layers, so the plugin cannot do it alone. Every other list still replaces, because some must: a user's `git.protected` is the whole list.
- **`workflow.disabled` drops a workflow by name,** whichever folder its file is in, so a user can leave out a company workflow. `/workflow
  list` says what was left out and names a name no file has. A ticket already on it is told, and its holds are not enforced while it is off.

## 2026-10-31: small gaps the example company plugin and later builds found, closed

`examples/jig-acme` listed what it had to work around ([its entry](#2026-10-31-an-example-company-plugin-jig-acme-proves-the-generic-plugins-need-no-company-code)),
and later builds left a few more. Each is closed here, as a commit of its own with tests and docs. Nothing is specific to a company.

**What `/jig` shows**
- **The environments, and who defined them.** `environments.list()` gives `{ name, kind, source }` with `source` one of `built-in`,
  `company` and `personal`, and `/jig` prints the same list grouped by source. A company plugin no longer keeps a list of its own;
  jig-acme's status line dropped its list. A refused definition is not listed, and nor is a name nobody defined (it counts as production).
- **"Not set" and "not set or invalid" are different things.** A registered section that no company default and no line of `jig.json`
  set says `not set`. A section the file has and the plugin did not get keeps the old words, as does a file that cannot be read.

**Jira: project keys.** `jira.projects` lists keys. A `search` with no JQL looks in them, newest first, and says which query it ran;
`create` refuses any other project before anyone is asked or Jira is called. A company can default it and the user's list replaces
it whole. With no list nothing changes: `search` needs JQL and `create` takes any project.

**Secret backends a company turns on**
- **Decided:** a company plugin may call `config.enableSecretBackends(["cmd", ...])`, and `secrets.disabledBackends` in the user's
  `jig.json` turns any backend off, whoever turned it on. The backends on are the user's list (`pass` alone by default), plus the
  company's, less the disabled ones. Without a company plugin nothing changes.
- **It adds no power.** A company plugin is code that already runs in Pi's process with the user's rights: it can read a file or start
  a program itself. Turning a backend on lets its own references resolve and nothing else. `cmd` still runs only commands declared
  by name, and `file` still refuses Pi's agent folder. The agent cannot call it: no tool offers it.
- **The old rule cost more than it protected.** Every user had to paste the same line before a company's sign-in worked, and the
  failure looked like a broken sign-in (`auth_failed`).
- **The user keeps the last word, and can see it.** A disabled backend stays off, and the refusal says the user turned it off.
  `/jig` lists the backends that are on and which a company enabled, so none turns on unseen.
- **Rejected:** letting an explicit `secrets.backends` override the company (it would silently undo the company's sign-in), and
  asking the user to confirm each enabled backend (that is the old rule again).
- **jig-acme** enables `cmd`, which its default token needs, and leaves `env` and the rest to the user.

**Transports.** A transport is told the caller's `maxBytes` and `timeoutMs` (the request's own, or the defaults), and may return a
repeated header as a list. `jig-core` folds a list with `, ` for the tool, as it folds a reply from the network, and keeps a
`set-cookie` list as whole cookies, so a date with a comma in it is never split.
- **Stop one byte past `maxBytes`,** not at it, so a reply of exactly that size and a longer one look different and `truncated` is
  right: a transport that stops at the cap hides the cut.
- **The fields are required in the type,** and `jig-core` fills them in for a caller of `transports.request` that leaves them out.

**Sandbox.** `network.allow` and `network.deny` are read by the proxy that `filtered` and `ask` route commands through. `allow` matters
in `ask` alone, and `deny` does nothing in `open` (or `off`). The docs say so, `/sandbox` shows a note from the check made when the
sandbox starts, and `/sandbox doctor` prints a warning line (not a failed check) when `deny` is set in `open`.

**Tunnel helpers.** `kit/ports.ts` has a port that is really free (handed out once it refuses connections), tests for a port that
accepts or answers a SOCKS5 greeting, and a wait that ends on a timeout, a cancel, or the failure of the program that should open
the port. `jig-mongo` imports it. A package of its own cannot import `jig-core`'s files, so jig-acme keeps a copy, as it does of
`client.ts`, and a test holds the two identical.

**GitLab, further**
- **`exec.run` vets the repository for `glab`,** as it does for `gh`, and gives glab git's fixed environment and its own. `jig-git`
  dropped its `git rev-parse` call and its environment.
- **`jig-workflow` reads a GitLab merge request.** `pull-request-open` and `checks-pass` read the merge request of the branch and the
  jobs of its latest pipeline with `glab api`, as `jig-git` does, and map them to the pull request and roll-up the conditions use.
  - **Why a copy of the forge decision:** plugins never import each other. The workflow reads the `git` section through `jig-core`
    (`forges`, `cloneHost`) and keeps the few rules itself; any other host stays on `gh`, as before.
  - **Subgroups:** a project is named by its whole path, so a CI watch of `platform/payments/orders-api` matches.
  - **Not verified:** the answers are recorded, not live.
- **`jig-ops` matches a project in subgroups.** The `jig-git:pushed` payload accepts up to twenty parts (refusing `.` and `..`).
- **An ssh alias for a real host.** A `git.forges` entry may be `{ "forge": "github", "host": "github.com" }` as well as `"github"` or
  `"gitlab"`. git keeps the alias in `origin`; `gh` gets `-R host/owner/name` (and `GH_HOST` for `gh api` and the comment watch)
  and `glab` gets `--hostname`. It is configuration only: no parameter can name a host. An alias that is not mapped is refused, now
  with a line that shows the object form.
  - **A change to the word form:** `"github"` used to leave `gh` to find a GitHub Enterprise Server repository from the remotes; it is
    now named as `host/owner/name`, which `gh` accepts and which also lets `requireSlug` calls work there.

**Tests.** The fake Pi that every plugin's tests load has `registerEntryRenderer`, `registerMessageRenderer`, `appendEntry`,
`sendUserMessage`, `getThinkingLevel` and `sessionManager.getBranch`, and keeps what a plugin sent; jig-acme's stand-ins are gone.
- **The acme tunnel test** failed with `ECONNRESET` or `ECONNREFUSED` on a busy machine. The fake `ssh` did not handle an error on a
  connection that the client had already closed (the readiness probe hangs up at once), so the reply failed, the process ended, and
  the next client was refused or reset. A test that hangs up 300 connections reproduced it on each try before the fix.
- **A sandbox wake-up test** slept 5 ms and expected the agent's read to beat a 40 ms burst, and its read was satisfied by the task's
  command in the header instead of its output. The burst is now held for 1.5 s, the read waits for the line, and the task's end shows
  that the burst was sent.

**Left.**
- **The contract grew two required members** (`environments.list`, `config.enableSecretBackends`), and `TransportRequest` two required
  fields; every plugin's test fake of `JigApi` gained them. A fake outside this repository must too.
- **`jig-sandbox`'s real-sandbox tests need `socat` and `rg`,** which this machine lacks, so its doctor test for the warning ran in CI
  only; the plugin-level tests of the same warning ran here.

## 2026-10-31: jig-agents, as built

Built to the design of the entry below, and tested with a fake child and with the stock Pi 1.4 on its own
scripted model. What building it changed or settled:
- **A worker's worktree is made by the plugin,** with `git worktree add -b <branch> <folder> HEAD` through
  `jig-core`'s `exec.git`, in a folder named `<repository>-<name>` beside the repository. The branch comes from
  a new field, `agents.branch` (default `agent/{name}`). The design had left "a worktree made by `start`
  through `jig-git`" for later; a worker cannot start without one. Through `jig-git` stays under *Later*.
- **A read-only role needs a tools list, and the plugin refuses only the tools it can name.** The design said a
  role that does not write is refused if its tools show as writes in `/jig rules`, but the plugin contract
  cannot ask. `bash`, `powershell`, `write`, `edit` and `notebook_edit` are refused, and so is a missing list,
  since the child's usual tools include them. `scout` and `reviewer` keep `git`, as the design's example lists it.
- **Without `enabledModels` any model is allowed,** which is Pi's own meaning of the missing setting. A role's
  model that Pi does not know is refused at `start`, before a process is made.
- **A question's time counts from its request,** not from the moment it reaches the screen, so one stuck
  behind another still runs out. The child's own `timeout` closes it too, and so does stopping the child.
- **The environment keeps `JIG_STATE_DIR`** so a child writes its records where the parent does, and the plugin
  sets `JIG_PARENT_SESSION` and `JIG_AGENT_ROLE`, which `jig-core`'s records already read.
- **A child leaves by itself when its parent is gone.** Pi in RPC mode, idle, only notes a request to shut down
  and acts on it at the next command, so the child's 10-second check asks Pi and then exits 5 seconds later.
  The real-Pi test found it.
- **The backstop ends the watch from the poll,** as `timed-out` with the partial report, instead of leaving
  the engine's generic words. No progress `update` is sent: `status` is there for that.
- **The size is about 3,000 lines with comments,** not 1,000. The estimate left out the checks, the cleaning of
  text and the orphan sweep. There is still no dependency.
- **The real Pi found what the fake child could not:** a child resumed soon after it ended was ended again by
  its old process's late exit event, and the 10-second parent check did nothing in an idle RPC Pi. Each
  process's events now answer only for that process, and the check ends the process itself.
- **Holds do not reach a child.** The gate follows the active ticket of the session it runs in, and a child has
  none. A workflow file can hold `subagent start` itself.

## 2026-10-31: jig-git talks to GitLab through glab api, and the repository decides the forge

Teams on GitLab use the same `pr` and `release` tools. A merge request is a pull request, and the actions keep their names.

- **The host of `origin` decides the forge,** with `git.forges` for a self-hosted host. The model never chooses it, so a call cannot
  send one forge's request with the other's sign-in. A host that is neither is refused with the setting that fixes it; an origin
  with no host stays on GitHub, as it was.
- **Every request is `glab api`,** not `glab mr`. glab's commands prompt and choose for themselves (`glab mr merge` turns on
  auto-merge while a pipeline runs; `glab release create` updates a release that exists), and a preview can promise only what is
  sent. The REST API is documented, takes a JSON body on standard input and gives JSON. Its `mr note` commands are experimental.
- **Sign-in is glab's.** Jig never signs in and never sees a token; `~/.config/glab-cli` was already protected. `GITLAB_TOKEN` is
  not on the short list of variables a program gets.
- **jig-core vets git and gh, not glab,** but glab starts git in its folder and reads its configuration. jig-git asks jig-core to
  vet the folder with a harmless git call before each glab call, and runs glab in the repository. Teaching jig-core's `exec.run`
  to treat `glab` like `gh` would be the cleaner fix; it was left, because this change is to jig-git.
- **What GitLab has no equivalent for is refused in one line** that names the GitLab way: a rebase in a merge, and a draft,
  pre-release or generated release notes. A draft merge request is a title prefix; a review is `draft_notes/bulk_publish` with
  `reviewer_state`, which refuses while the user has drafts pending, because they would be published too.
- **A thread is `<number>:<discussion id>`** because GitLab addresses a discussion by both.
- **The comment watch reads discussions.** GitLab has no `updated_after` for them and its notes endpoint leaves out the notes inside
  threads, so the discussions are read in full (up to 500 threads) and what was told is remembered by id. ETags are sent; a `304`
  counts against GitLab's rate limit, so they save the transfer and not the request.
- **Not verified:** there is no GitLab account. The tests run a fake `glab` over recorded answers, and the few real checks are in
  [Not verified yet](../plugins/jig-git/docs/not-verified.md#gitlab-not-verified).
- **Left:** `jig-ops` matches `jig-git:pushed` on `owner/name`, so a project in a subgroup starts no CI watch yet; `jig-workflow`'s
  `pull-request-open` reads `gh pr view`; `clone` is GitHub only; an ssh alias is not a GitLab host.

## 2026-10-31: jig-workflow, evidence and holds: a gate in jig-core, tests in the sandbox

- **A condition is decided from evidence the plugin made,** not from what the agent says. The agent can
  ask for a test run, a plan approval or a check; the plugin records the outcome against the commit or
  the plan it is about, and an old result stops counting when either changes.
- **Holds are a gate in `jig-core`:** `gates.register(gate)`. A gate sees each call after the rules have
  decided and can answer `ask` or `deny`, never `allow`, so a wrong workflow file can make work slower and
  not less safe. A failing gate denies, like every failure in `jig-core`. It is a new decision source, `gate`.
- **Some calls always ask,** through the same gate: a plan to approve, a stage that needs you, a switch of
  workflow, and a test run outside the sandbox. A rule or an "allow for this session" cannot answer them,
  because the point is a fresh answer about this exact thing.
- **Tests run in the sandbox.** `jig-core` gets `sandbox.run`, which `jig-sandbox` implements with the same
  wrapping as `bash`. With no sandbox the run is never silent: it asks, naming each command, as
  `bash` run outside does. Tests are the agent's own checks on its own work, and the sandbox is what makes
  letting it run them safe.
- **A test result belongs to a full commit on a clean tree.** A pass on a dirty tree is shown and never
  counted, because it says nothing about what a push sends.
- **The state is a file in the ticket folder, written only by the plugin** and guarded from Pi's file tools
  and the sandbox. An agent that could edit it could mark anything passed. The workflow's definition is
  not copied into it, so a mended workflow file applies at the next reload.
- **Review and CI evidence come from events,** checked on arrival. `jig-review:approved` gets the
  repository's folder (`root`), because a path from Pi's folder is ambiguous outside it, and `jig-ops` gets
  `jig-ops:ci-finished`, because a watch's result names no commit. `pull-request-open` and the fallback for
  `checks-pass` read `gh pr view` through `jig-core`'s `exec`.
- **Examples, not company workflows.** `feature`, `bugfix` and `investigation` are in the plugin's
  `examples/`. A company's files arrive through `jig-core`'s section defaults for `workflow.folders`,
  which work in any load order.
- **Left for later:** check tiers, a checker agent, the review ledger and one approval per change.

## 2026-10-31: an example company plugin, jig-acme, proves the generic plugins need no company code

"Jig is generic" was a sentence in the docs. `examples/jig-acme` makes it a test: a company plugin for a made-up company, Acme
Corp, that configures every plugin that has a section and adds a sign-in service, a transport and a tunnel, using only the public
contract. It is also the template for a real company plugin, with [Writing a company plugin](company-plugin.md).

- **Under `examples/`, not `plugins/`.** It is not part of Jig: the package manifest does not list it, so `pi install` of Jig never
  loads it, and the generic plugins still know nothing of any company. Its names are fictional (`acme.example`, `orders-api`,
  `ACME-123`), so the rule that nothing company-specific goes in this repository holds.
- **The public contract only.** It reaches `jig-core` through the global handle: `src/jig/client.ts` is a copy of `client.ts`, a test
  fails when the two differ, and the contract's types come in with `import type`. Everything it does goes through calls the contract
  already has; what was awkward is listed below.
- **Tested against the real thing.** The tests load the real `jig-core` and every built plugin into the fake Pi from `jig-core`'s
  tests, so a default is checked by the plugin's own check and a user's override by the plugin's own `replace` and `oneOf` keys, not
  by a copy of them. The sign-in service and the transport run against a fake server on `127.0.0.1`, and the tunnel against a fake
  `ssh` first on `PATH`. CI runs them: `npm test` takes `examples/*/test/*.test.ts`.
- **It keeps its own hands clean.** The sign-in service and the transport refuse a host that is not Acme's, and plain http to
  anything but this machine, so a credential cannot go where somebody else chose. The gateway must be on this machine because the
  request to it is in clear text. A secret is a reference and a pasted value is refused without being repeated.

**What it found, and left as it is**
- **Jira has no place for project keys.** The `jira` section reads the project from each call, so Acme's key is in the ticket
  pattern, the branch rules and the overlay skill. A Cloud login is an email and a token, the email is the user's, and `auth`
  replaces whole, so a company that wants per-person Cloud logins cannot default one; the example uses a shared automation account.
- **`/jig` does not list the environments.** The contract has `environments.kindOf` and nothing that lists them, so a company plugin
  keeps its own list and shows it through `status.register`.
- **A company cannot turn a secret backend on,** which is the user's decision. A company's `cmd:` or `env:` sign-in is inert until
  each user adds the backend, and the README has to say so.
- **A transport is not told the caller's `maxBytes` or time limit,** and carries text only, so it reads the whole reply up to a cap
  of its own. A repeated reply header must be folded into one string.
- **`sandbox.network.deny` does nothing in the default `open` mode.** A company's deny list is silent until each user picks
  `filtered` or `ask`.
- **A tunnel needs three helpers each time:** a free port that is really free (a closed listener can still accept for a moment), a
  wait until the port answers, and a long-lived program (`exec.run` with a signal and a long timeout). `jig-mongo` has its own copies.
- **The fake Pi lacks calls the other plugins make** (`registerEntryRenderer`, `appendEntry`, `sendUserMessage`,
  `getThinkingLevel`, `sessionManager.getBranch`), and `jig-sandbox` starts a real sandbox at session start. A test of "every
  plugin" needs stand-ins and an unsupported platform for the sandbox. A shared fake, or a switch on the sandbox, would help.
- **Defaults are untyped data,** and a mistake shows only when a session starts, so the tests must load the plugins. Defaults cannot
  depend on the user's settings (an email, say) without being registered again after the file is read.

## 2026-10-31: production reads need an index, and pull request comments reach the agent

Two gaps, closed together because both needed a small addition to `jig-core`.

**jig-mongo: a production read must use an index**
- **The planner decides, and nothing is executed.** Before a `find`, `count`, `distinct` or `aggregate` runs in production,
  `explain` at `queryPlanner` is asked, and a winning plan with a `COLLSCAN` is refused. The refusal names up to 5 fields that
  lead an index (only ones the access lists let the agent see), so the query can be rewritten. A scan of a big collection is slow
  for everyone who uses the database, and a broad scan is how too much data gets read.
- **Checked as it will run.** A `count` is explained as the pipeline `countDocuments` runs, so a count with no filter is refused
  without asking. `sample` and `schema` are checked when they carry a filter, and `explain` at `executionStats` is checked
  because the server runs it. These go past the four actions first listed, and each is the same hole under another name.
- **The planner does not say everything.** On MongoDB 8.0 it reports a `$unionWith` scan and, in some plans, a `$lookup` that
  reads the joined collection whole (`EQ_LOOKUP`); in others it says nothing of the joined side. So each `$lookup` that matches on
  a field is also checked against the index list of the joined collection. A `$lookup` written only as a sub-pipeline is not
  caught where the planner is silent, and [Not verified yet](../plugins/jig-mongo/docs/not-verified.md) says so.
- **A check that cannot be made refuses.** A failed `explain` (no privilege, a dropped connection) and a plan with no stage in it
  are refusals, not passes.
- **On for production, per connection otherwise.** `requireIndex` turns it on for a test environment or off for one production
  connection. Off is the user's choice, so `/jig` says so, which needed `status.register` in `jig-core` (below). A small
  collection of an allow list is marked `{ "fields": [...], "reference": true }` and is read whole. A deny list has no way to mark
  one, so a test environment that turns the check on and needs reference data uses an allow list.

**jig-git: comments on your pull request land in the agent**
- **A watch needed a way to speak before it ends.** `jig-core`'s engine told the agent only when a watch finished or paused. A poll
  can now return an `update` (a summary, details and links), which is cleaned like a result and sent in a message of its own while
  the watch goes on. A poll that is also the end sends its update first, in the same message.
- **Polls cost nothing while quiet.** The four requests of a poll are conditional (`gh api -i` with `If-None-Match`), and GitHub
  answers `304` without counting it against the rate limit. What was told is remembered by id, in the watch's state, which is saved
  with the update, so a comment is told once. A crash in the second between the message and the save loses news and does not say it
  twice.
- **Backoff is the watch's own.** `jig-core` pauses a watch after three failed polls but does not wait longer between them. A
  server error, a rate limit or a lost connection makes this watch wait 2, 4, 8 and 10 minutes first (longer if GitHub asks), and
  leaves its state as it was. Only then does the poll fail and the three-in-a-row pause apply.
- **The agent can answer.** `pr reply` takes a review thread, and GitHub's REST answer does not name it, so one GraphQL read finds
  it when there is a line comment to tell. Without it the comment is told with how to find the thread.
- **Comments are text from anyone who may comment,** and a public pull request may be commented on by anyone. The message says
  they are information to weigh, not instructions to follow, and the agent's replies still ask the user on the review screen, so a
  comment can steer the agent but cannot send anything on its own. The agent's own comments and bots' are not told.
- **Started without asking, ended by itself.** `pr watch` is a local write like `ci watch`, since it only reads GitHub. `pr create`
  starts it unless `git.watchComments` is `"off"`. It ends on merge or close with one last message, after 7 days, or on `watch stop`.
  The first poll tells the newest 10 comments already there, so an old pull request does not flood the agent.

**jig-core: two small additions.** `PollOutcome.update` for the watch above, and `status.register(plugin, lines)` for lines that
`/jig` shows. The second is optional in the contract's type so that a test's stand-in for `jig-core` need not have it.

## 2026-10-31: jig-agents is built by us, on Pi's RPC mode

- **No package is adopted.** About 250 names were found, 146 sorted by name and weekly
  downloads, about 20 read by README and 8 in the code that launches a child. None
  keeps every child under `jig-core` and `jig-sandbox`, sends a child's question to the
  parent's screen through `jig-core`'s own dialogs, and limits turns, time and cost. The
  most used, `pi-subagents` (326,000 a week), does not govern its foreground children,
  has no turn limit, and is 10.7 MB. The two small ones that run a separate Pi in RPC
  mode, `@deathbeam/pi-delegate` and `@ferris1225/pi-subagents`, deny a child's
  questions and have no limits ([Options](../plugins/jig-agents/docs/options.md)).
- **A thin plugin around one does not help.** A child's dialogs are answered inside the
  package's launch code, limits that stop a running child need an event stream the
  package owns, and in several the list of extensions is set by an agent file or a call.
  `pi-subagents` has a hook that forces plugins in, which fixes only the last.
- **A child is `pi --mode rpc`, started by the plugin.** It is the same program with the
  same plugins and `jig.json`, so every rule that governs the parent governs the child.
  The command line is built from fixed parts and never holds `--no-extensions`, `-e` or
  `--extension`. At start the plugin checks that the child lists `jig-core`'s commands,
  and stops it if not. The estimate is about 1,000 lines and no dependency.
- **A child's questions go to your screen, and every failure is a no.** In RPC mode Pi
  turns the child's dialog into a request with a random id; the parent shows it under a
  header it writes, queued, and answers on the pipe only it holds. No screen, no answer in
  time, too many questions, or a request it cannot read: the question is cancelled, which
  the child's `jig-core` counts as a decline. It is the "approving from another session"
  that [Approvals](approvals.md) lists as later, with no file and no web endpoint, and
  the floor is still decided in the child.
- **The parent enforces the limits.** Turns come from the child's events, minutes from a
  timer that does not count time spent waiting for you, and cost from `get_session_stats`.
  At a limit the child is told to write its report, then aborted, then ended. The earlier
  harness asked in a prompt and checked time only at a turn end, and a long tool call
  overran it.
- **A result is a watch.** `jig-core`'s engine already sends one follow-up message that
  starts a turn, combined, spaced and cleaned, so the parent never polls. The engine's
  outcome words are CI-shaped (`passed` for a clean finish); a `finished` word is a later,
  small change.
- **Models and limits are configuration, not agent files.** A public agent file never
  names a company's model, and a company plugin sets models through `jig-core`'s section
  defaults. Agent files are read only from the plugin, the company plugin and the user's
  agent folder, never from the project, which the model can write.
- **Terminal panes are dropped.** That gives up a live view of a child, children that
  survive a `/reload`, and interactive roles such as the earlier planner. It buys no
  tmux, no orphans (a child ends with its parent session), and a screen that only the
  parent owns, which is what makes forwarding questions safe.
- **Nothing has been run.** The first thing built is a test with a real Pi child and a
  scripted model: a question reaches a fake screen and the answer returns, a child
  without `jig-core` is stopped, each limit stops a looping child, and the child's own
  `bash` cannot answer for it.

## 2026-10-31: jig-memory cards and recall: the agent writes the prose, keys and keywords find it

- **A card per closed ticket, in two halves.** The plugin fills the front matter
  (repositories, keys, identifiers, error lines) by fixed patterns from the notes and
  evidence, so the half recall depends on is the same every time and needs no model.
  The agent writes only Problem, Cause and Fix, up to 400 characters each, and the
  plugin rejects a card that misses one or runs over.
- **One request, one correction.** `/ticket close` sends one follow-up message and
  checks the file when the agent settles. A card that fails gets one correction
  message and then a warning, not a loop. A model often misjudges a character limit,
  so a rejected card with no second try would be common.
- **Recall is shared keys first, then BM25.** An error line, an identifier or a
  ticket key two tickets share is strong evidence; a shared word is weak. Both add
  up to one score with a threshold, so a quiet recall is a result and not a failure.
  BM25 is a short function of our own, with no dependency.
- **Files, not embeddings.** The cards are plain files and the index is a copy
  (`.cards.json`) that rebuilds itself. Embeddings or a graph wait for a measurement
  on real tickets that shows misses. The recall test in `test/recall-eval/` uses
  invented tickets: it guards the scoring against regressions, and says nothing yet
  about real ones.
- **The threshold was tuned on the test.** The first run, at a `minScore` of 2.5, gave
  recall 0.786 and precision 0.917. A sweep with nothing else changed showed 2 beat
  2.5 on both (0.893 and 0.926), so 2 is the default. The test is 30 invented
  queries, so the number is a starting point, and the sweep is in the recall page.
- **Recall arrives as a message, not in the prompt.** The cache of the system prompt
  stays valid, and the agent can ignore a hint that does not fit.
- **Ticket text.** `jig-jira` does not publish an issue's summary and description on
  Pi's event bus, so recall uses the activating message and the key. `jig-jira` was
  left alone: a new event there is its own decision.

## 2026-10-31: jig-sandbox, background tasks and the network modes, as built

The last two build steps are built and tested. What building them changed in the design:
- **Tasks are started by Pi's side,** not through Pi's bash tool, so it owns the process
  group and the pipes. A task is wrapped with the rules of a foreground command, and its
  output is cleaned and has credential values taken out before it is written, so the log
  holds nothing that needs cleaning later.
- **Logs live in the agent folder,** not in the session's folder under `/tmp`. The sandbox
  can write `/tmp`, and a command could swap a log for a link to a file Pi can read and the
  command cannot; `bg_output` would then show it.
- **Wake-up patterns are regular expressions,** as the design said, checked for the three
  constructs that make matching slow and for a pattern that matches an empty line. The
  earlier harness took literal text only. A line is cut to 4 KiB before it is matched.
- **A task cannot run outside the sandbox.** `jig-core` refuses `background` with
  `outside` and nobody is asked: a task outlives the call a person could watch. With the
  sandbox switched off, a task is refused too.
- **`approvals.inTurn` is the one new `jig-core` call.** It runs a plugin's own question in
  `jig-core`'s queue, so a question about a host never opens over one of `jig-core`'s. The
  question about a write uses it too, which retires the separate queue.
- **Names and addresses are checked by Pi, not by the runtime.** `allow` and `deny` are
  read by the callback and not given to the runtime, which does not check an address it
  decides itself. A spelling that a program may read as `127.0.0.1` (`2130706433`,
  `0x7f000001`, `127.1`) is refused as not being a host name.
- **A port in `network.localhost` opens loopback and this machine's own addresses at that
  port,** not link-local, private or carrier addresses: a listed database port must not open
  a neighbour's. Metadata stays refused whatever is listed.
- **The runtime has no option for a named Unix socket on Linux,** so the bridge does not
  use one. A forwarder in each command asks the proxy for `127.0.0.1:<port>` over TCP, and
  the callback allows exactly the ports a listener of the bridge is on. A tunnel's port is
  not one, because the machine already uses it.
- **`nsenter` cannot enter a task's network.** The network namespace belongs to a user
  namespace that no process is in. A short `python3` helper joins that user namespace (the
  kernel names it for the network namespace's file) and then the network namespace; the
  bridge needs `python3` for task ports, and says so when it is missing.
- **`Once` lasts 15 seconds.** A command opens several connections, and asking for each
  would be asking about the same thing again.
- **On macOS `filtered` and `ask` mean `off`.** The bridge is written for Linux's network
  namespaces and has not been tried on a Mac.

## 2026-10-31: jig-sandbox, as built

The first two build steps (everything except background tasks and the `filtered` and
`ask` network modes) are built and tested. What building them changed in the design:
- **Docker goes through `outside`, not `docker: true`.** The runtime cannot allow one Unix
  socket by path on Linux, and `allowAllUnixSockets` would let a command start Windows
  programs on WSL. The `docker` field is reserved.
- **The tool is Pi's own definition with operations of its own,** not a spawn hook: the hook
  is synchronous and wrapping a command is not.
- **A mode that is not built means `off`,** never a more open mode.
- **Rules are computed for every command,** from the file system as it is, and a path under
  a hidden folder is not resolved (on WSL the Windows part of `PATH` takes seconds).
- **`share` cannot unlock either.** It cannot open a credential and it cannot make a locked
  path writable, since locked is the second promise.
- **`PATH` folders are locked only in the home folder, outside the working folder.**
  A project's `node_modules/.bin` is the user's own choice of where to run things from.
- **The audit takes away and keeps.** What a command planted is moved into the agent folder,
  which the sandbox cannot write, so a file the user made at the same moment is not lost. A
  locked link that was removed and made again is put back. Moving a locked path's folder
  aside is refused by the kernel, so that case needs no code.
- **The question about a write has its own queue,** one at a time, and can overlap a
  `jig-core` question. The host questions of `ask` mode will share `jig-core`'s queue
  (done, with the question about a write, in the entry above).
- **`outside` is hardened where the design left it open:** a command pattern's `*` does not
  reach across `;`, `&`, `|`, `<`, `>`, a backquote, `$(` or a line break; the dialog shows
  control characters as escapes and refuses a command too long to read (1,000 characters,
  8 lines); `jig-sandbox` runs it only for the tool call `jig-core` announced an allow for,
  and only if the command is the one shown. A declaration can extend the built-in
  classification of `bash`, so the user's own classification rules still apply to it.

## 2026-10-31: jig-sandbox, built on Anthropic's sandbox runtime

- **Why a sandbox at all.** `jig-core` keeps Pi's file tools away from credentials,
  but a `bash` command can still read `~/.ssh` or write `~/.bashrc`. The floor's
  "credentials stay hidden from bash" needs a sandbox to hold.
- **Why not an existing package.** The Pi store has about a dozen. The closest,
  `@erichll/pi-sandbox`, is well made, but:
  - it brings a second approval system, where a reviewer model approves network
    destinations, beside `jig-core`'s rule that you approve in the waiting call;
  - it cannot make folders outside the project writable, so Gradle and Maven builds
    fail;
  - it only keeps project `.env` files from being written, not from being read.

  Others leave the home folder readable, bring their own permission system, or
  sandbox the whole Pi process (Docker, OpenShell, Gondolin), which also cuts Jig's
  own tools off from the credentials they need.
- **Why Anthropic's sandbox runtime.** It is the engine those packages use: bubblewrap
  and a network namespace on Linux, Seatbelt on macOS, a proxy for every connection,
  seccomp against local sockets and new user namespaces. Released about weekly,
  Apache-2.0. `jig-sandbox` writes only the rules and the joins to `jig-core`. It is
  pinned to an exact version, because the runtime is still `0.0.x`.
- **One list of hidden paths.** The sandbox hides what `jig-core` protects, company
  additions included, so the file tools and `bash` cannot disagree.
- **Writable by default, with exact lists.** An allow-only sandbox breaks every tool
  that keeps state in a folder nobody listed. The earlier harness's sandbox was
  writable except for its lists, and in about a thousand of the owner's commands it
  refused no write as read-only. So only hidden and locked paths are listed.
- **Locked is about escapes.** Anything that runs later outside the sandbox is
  locked: shell start-up files, `PATH` folders, git hooks, Pi's settings and
  extensions, editor and agent settings that run hooks, Gradle's init scripts. The
  October audit of the earlier harness found escapes through exactly these.
- **Build caches are shared.** `~/.gradle/caches` and the like stay writable, so
  builds run as outside; Gradle's `init.gradle` and `init.d` (run by every build) are
  locked and its `gradle.properties` hidden. Tampering with a cached download stays a
  known risk until stand-in credentials let separate caches reach private
  repositories.
- **No dead ends.** Each block names its rule and the way through; toolchain folders
  ask you instead of refusing; `git config` works, and settings that would run a
  program outside are taken back out after each command.
- **Network: the machine's own by default.** In `open` mode the sandbox runtime leaves
  the network alone, so servers, `localhost` and DNS work as outside, as they did in
  the earlier harness. `filtered`, `ask` and `off` route every connection through the
  runtime's proxy, which also keeps bash away from `localhost` tunnels to production;
  a bridge carries background tasks' ports and listed `localhost` ports into each
  command, because there every command has a network of its own.
- **The runtime runs in a broker process, not in Pi.** A spike on a real machine
  showed that its built-in protections create placeholder files in the working folder
  of the process running it (in Pi, the project, where `git add -A` could commit
  them), and that it installs signal handlers that keep a process alive. One broker
  per session, with its own working folder, keeps both out of Pi and the project.
- **One command can run outside, with your approval.** Some work needs what the
  sandbox holds back (Docker, credentials, a private repository), and retyping the
  command as your own `!` is friction. So the agent can ask to run one command
  outside: `jig-core` asks you with the exact command and reason, only a rule naming
  the command can allow it without asking, and no screen means no. Unlike Claude
  Code's escape hatch, no mode approves it without asking.
- **Your `!` commands are not sandboxed.** They are yours, as in the earlier harness.
- **Fails closed, but optional.** With `jig-sandbox` installed, a sandbox that cannot
  start refuses `bash`. Without it, Jig still works and says plainly that bash is not
  sandboxed: running inside a container is a valid setup.

## 2026-10-31: gaps a company plugin found in jig-core, closed

A company plugin that configured Jig for its own systems found these. Each is
generic: no company is named.

- **A sign-in service sees the whole request.** `SignInRequest` now carries the
  `method`, the `headers` the request will carry (without the credential) and
  the `body`, as well as `system` and `url`.
  - **Why:** a service that signs requests (an HMAC scheme, AWS Signature
    Version 4) signed a POST as a GET, and the server answered 401.
  - **Required, not optional:** a service that cannot rely on the method would
    sign a guess. `jig-core` refuses a request without a method or headers
    before the service is asked.
- **A section is checked laid over the company's defaults.** `loadPersonalConfig`
  used to check your section alone and drop it on error, so a user who wrote
  only what they change (`{ "jira": { "site": "…" } }`) got an error.
  - **With defaults,** your section is validated after it is laid over them. A
    section with none is validated as before.
  - **Defaults that need you:** with no section of yours and defaults that are
    not valid alone, the plugin is not configured. No start-up problem is
    reported; `/jig` says the company defaults are incomplete.
  - **`registerSection(name, validate, { replace })`** names keys that replace
    the company's whole instead of merging, so `auth: { token }` never merges into
    `auth: { transport }`. A key is a path from the section's root, with `*` for
    any one name. Declared by `jig-ops` (CI `auth`, `deploy`), `jig-api`
    (`environments.*`) and `jig-mongo` (`via`).
- **A tunnel says what it is, and `jig-mongo` uses both kinds.** A `Tunnel` has a
  `kind`: `forward` (the default: a local port that reaches one host and port)
  or `socks` (a local SOCKS5 proxy that reaches any host the far side can).
  - **Why:** a `mongodb+srv` address or a replica set needs every member
    reached, which a forward cannot do. With a SOCKS tunnel `jig-mongo` gives the
    driver `proxyHost` and `proxyPort`, and keeps the real address.
  - **`jig-mongo` now opens a company tunnel through `jig-core`.** Until now a
    `via: { tunnel }` route always failed with "no tunnel provider is registered",
    although `jig-core` had a registry. A forward is used as an SSH forward is.
  - **A new dependency, `socks` 2.8.9, pinned exactly (MIT).** The driver needs it
    to go through a proxy and does not install it. Its own dependencies are
    `ip-address` and `smart-buffer`.
  - **A `mongodb+srv` address is still looked up in this machine's DNS:** the
    driver cannot send a lookup through a proxy.
- **An environment may have several MongoDB connections.**
  `connections.<environment>` is one connection, as before, or a map of named
  ones (`orders` and `billing` in `staging`).
  - **The tool takes `cluster`,** required where an environment is a map and
    refused where it has one connection. The environment still decides the
    rules, so classification is unchanged.
  - **Access lists are per connection** for such an environment, and keep their
    shape for one connection.
  - **The user can be a secret reference,** like the password; plain text still
    works. A value that starts with the name of a secret backend and a colon is
    read as a reference.
- **More personal-data field names are masked by default.** Telecom names that
  were found unmasked: `ani`, `dnis`, `cli`, `btn`, `fax`, `mobile`, `cell` and
  the `...Number` forms (`faxNumber`, `callerNumber`, `destinationNumber`),
  `tnList`, `portingTn` and `callerId` are phone fields; `sipUri` and the contact
  fields (`contact`, `billToContact`, ...) are `personal` tokens.
  - **In the word-based rules, not a flat list.** The short names match as the
    whole name only, so `client` is not `cli`. A descriptor still keeps a field
    out (`mobileType`).
  - **A contact masks only a scalar,** through a new `contact` kind: an object
    under it is read field by field, so a `billToContact` record keeps its ids.
  - **The corpus said `contact` was kept;** it is masked now, on purpose.
- **A flaky `jig-mongo` route test is deterministic.** The tests where the SSH
  forward must not come up used the real probe, which connects to the port
  `freePort` handed out.
  - **The assumption:** that port stays free. In a full run other test files open
    servers on port 0 at the same moment, one can be given the same port, and the
    probe then calls that server a forward that works: a call that has to fail
    succeeds.
  - **Fix:** those tests inject a probe that finds nothing listening. The tests
    that need a working forward still use a real port.
  - **Not fixed, and not a test matter:** `jig-mongo` cannot tell its own `ssh` from
    another listener on that port. Letting `ssh` report when it is ready would.
- **A connection failure is no longer described twice.** The line for a database
  that could not be reached was turned into "the database driver failed" by a
  second pass, so `jig-mongo` now says "cannot reach the staging/orders database".

## 2026-10-31: filter lists, Jira links and a pull request title rule

A company plugin found three gaps while configuring these plugins. Each is a
generic fix, in its own commit.

- **jig-logs: a filter value can be a list.** "The namespace is one of these"
  could not be written, because a `filter` entry was one exact value.
  - **Elasticsearch:** a list is a `terms` clause in `bool.filter`, next to the
    `term` of a single value.
  - **Loki gets a `filter` too,** which the docs had said it did not have. Each
    entry is a matcher added to the selector: `label="value"`, or
    `label=~"a|b"` for a list, with each value escaped as a line filter's text is.
  - **A list holds 1 to 50 values;** an empty one is refused when the
    configuration is checked.
  - **Not a tool parameter:** the tool has no field filter, because the text of
    a call never becomes a field name. Lists are configuration only.
- **jig-jira: a comment works without `/myself`.** Some sites reach Jira only
  through a sign-in proxy that has no "who am I".
  - **What `me` was for:** the "as <name>" in the preview, the account in the
    fingerprint, and telling your comment from another one after a lost reply.
  - **When `/myself` answers 403 or 404, or the transport refuses it:** the
    comment still goes. The preview drops the name and says why, and the read
    after a lost reply goes by the text alone, so it can say "did not happen"
    but only "could not settle it" when a comment has the text.
  - **Any other failure still stops the comment.**
- **jig-jira: `link`, `unlink` and `link_types`.**
  - **A call reads "key <phrase> to":** `blocks` makes `key` the outward end, and
    the inward phrase (`is blocked by`) turns it round. A name or an id means the
    outward reading.
  - **`unlink` finds the link by its two issues** in `key`'s own links, so the
    model never handles a link id. `linkType` says which when there are several.
  - **Both are external writes on a dialog:** no text, so no review screen. The
    preview names both issues and the type, and says which issue Jira gets as
    `outwardIssue`.
  - **Unverified:** that `outwardIssue` is the issue that reads "blocks". It is
    listed in the not-verified page, with where to swap it.
- **jig-jira: `createDefaults`.** A map of field name to value that `create`
  applies when the call does not set that field.
  - **Names resolve like the call's own `fields`,** so a default and a field in a
    call mean the same thing by the same name.
  - **Shown as "from your defaults"** and part of the request, so the person
    approves them and a change while they read voids the approval.
  - **A default that does not fit** (not on this issue type's screen) is left
    out with a note, because it was meant for every create. A value the screen
    refuses stops the call and says where it came from.
- **jig-git: a pull request title rule, `git.prTitle`.** An optional regular
  expression that the title of `pr create` and of `pr edit` must match, as
  `git.commitMessage` does for a commit.
  - **Refused while the preview is built,** so nobody is asked and nothing is
    sent. The message shows the pattern.
  - **An `edit` that does not set a title is not checked:** the rule is about
    what is written now, not about a title that was there before.

## 2026-10-30: Jig never signs in; it reads a credential and keeps it from the agent

- **No sign-in flow in Jig.** No plugin starts an OAuth flow, opens a browser to
  log you in, asks for a password, or runs a device-code exchange.
  - **The tool that owns a login does it:** `gh` for GitHub, the Postman CLI for
    Postman, Pi's `/mcp login` for MCP servers, a company plugin's sign-in
    service for its own systems.
  - **Why:** they already do it well, and each has its own idea of expiry,
    refresh and revocation that Jig would only copy badly.
- **No stored credentials.** Jig keeps no token, key or password of its own:
  not in `jig.json`, not in a state folder, not in a plugin's section. A
  credential lives where its owner put it, and Jig only reads it from a source
  you configured (`pass`, `env`, `keychain`, `op`, or a named command such as
  `gh auth token`).
- **What Jig does do, in `jig-core`:**
  - It reads a credential that already exists and attaches it to a request, so
    plugin code never sees the value.
  - It registers the value with the redactor, so it never reaches the model.
  - A client-credentials or password grant against a token endpoint, with the
    client's secret read from a source you configured, is a request like any
    other: the token is held in memory only, and no browser is involved.
- **And it keeps credential stores and its own files out of the agent's
  reach.**
  - Pi's file tools refuse the credential files of the tools Jig delegates
    sign-in to, and refuse writes to Pi's agent folder, where Jig's
    configuration and the passkey store live.
  - That is a floor rule, so configuration can add paths and never remove one
    (see [Permissions](permissions.md)).
- **Why now:** the passkey store in the entry below relies on the agent not
  being able to write the agent folder, and delegating sign-in to `gh` is safe
  only if the agent cannot read the token file `gh` keeps. Both promises were
  open until Pi's own file tools were covered.

## 2026-10-30: checks run on every push

- **Biome for formatting and linting.** One tool for both, fast (the whole
  repository in about two seconds), with no plugins to install.
  - **Pinned to an exact version:** a new release can change what the formatter
    writes, so a bump is a change you review.
  - **Why now:** the repository had no formatter, and `jig-api` alone had 512
    lines over 120 characters.
- **Line width 120, 4-space indents, double quotes, semicolons, trailing commas
  everywhere.** That is how most of the code was already written, so it is the
  choice that changes the fewest lines. One commit formatted everything and
  nothing else; `.git-blame-ignore-revs` makes `git blame` skip it.
- **Rules turned off, where the code is deliberate:**
  - `noNonNullAssertion` (131 hits): `noUncheckedIndexedAccess` is on, and
    `items[0]!` is how the code says "this is there".
  - `noControlCharactersInRegex` (117): the code strips and refuses control
    characters from untrusted text on purpose.
  - In tests only: `noExplicitAny` (77), `noAssignInExpressions` (64) and
    `noCommaOperator` (24), where fakes capture arguments inline, and
    `noAdjacentSpacesInRegex` (10), where a test matches an aligned table with
    its literal spaces. Source code keeps those four rules on.
  - Every other finding was fixed, or silenced on its own line with a reason (7
    places).
- **Left outside Biome:** `plugins/jig-logs/test/golden`, which the tests
  compare byte for byte; `package-lock.json`; and the review page
  (`plugins/jig-review/web`), which has its own package and 2-space style, and
  whose sources are hashed into `web/build.json`, so reformatting it means a
  rebuilt manifest.
- **The review page is in the checks.** `check:web` and `test:web` run its type
  check and tests. `check:dist` builds it into a temporary folder and compares
  with the committed `web/dist` byte for byte; the build is reproducible, so a
  source change with no rebuilt `dist` fails instead of shipping a stale page.
- **Actions are pinned by commit SHA,** with the version in a comment. A tag
  can be moved to other code after you read it; a commit cannot. The job has
  read-only permissions, no secrets, no stored credentials, and runs only on
  pushes to `main` and on pull requests.
- **Pi 1.4.0 is installed in CI.** The type check reads Pi's declarations
  through `test/support/link-host.mjs`, which links the globally installed Pi.
  Installing the version Jig is built against means the check no longer depends
  on whichever Pi one machine happens to have. Move it when Jig moves to a newer
  Pi.

## 2026-10-30: jig-theme, the look, built on Pi's own themes

- **One plugin for how Pi looks:** palettes, the footer, and the answer colour.
  It has no tools, so the model never sees it.
- **Palettes are Pi theme files,** not colours painted by an extension. Pi's
  `/settings`, its HTML export and its hot reload then work with them, and they
  work without the rest of Jig.
- **A palette is seventeen named colours and one shared role map.** Adding a
  palette, or your own, means choosing those colours, not filling every role.
  A palette can still set single roles where the map is not right for it. The
  first two palettes, drawn before the map, set 15 and 14 roles that way; the
  other four set none.
- **Your palettes are written into Pi's themes folder.** Pi finds a theme there
  by name, even one written after it started, and reloads the one in use when
  its file changes. `jig-theme` records a hash of each file it writes, and
  writes or deletes only a file whose hash still matches, so a file you changed
  by hand is never overwritten.
- **`/theme reload` is a reload of Pi.** `jig.json` is read when a session
  starts, and `jig-core` has no way to read it again on request, so a reload is
  the one honest way to see an edit.
  - Pi reads the themes folder before a session starts, so it knows a palette
    that changed since by its old colours.
  - The plugin writes that palette's own file once more, which Pi's watcher
    takes as a change.
- **Other plugins add footer parts on Pi's event bus,** `jig-theme:segment`. A
  plugin then does not depend on `jig-theme`, and nothing breaks without it.
- **The usage history goes to `jig-lens`** as `/lens usage`, because it is about
  cost, which is what `jig-lens` shows.
- **Company parts stay in the company plugin:** a model spend in the footer, and
  names for the models its provider records.

## 2026-10-30: reviews are approved in their page, and a passkey makes that unforgeable

- **You chose to approve a review in its page.** A review is long, it waits for
  you across many turns, and the page is where you read it. Sending you back to Pi
  to type `y` after reading there was friction with no extra safety, once the
  approval itself cannot be forged.
- **The old rule did not go.** [Approvals](approvals.md) say you approve inside
  the waiting call, because a web endpoint is reachable from the agent's shell.
  That reason still holds for a button.
  - **What changed is the endpoint:** it checks a WebAuthn signature over a
    fresh challenge, made by a key on your device after the device checked you.
  - **The agent cannot make it,** so the endpoint's address stops mattering. A
    stolen cookie can comment as you; it cannot approve.
- **A passkey, written on `node:crypto`.** No WebAuthn library: the checks are a
  few hundred lines that can be read whole.
  - **The checks:** a small CBOR decoder, the COSE key, the challenge, origin,
    relying party id hash, user presence and verification, the signature and the
    counter.
  - **The keys:** ES256 and RS256, which is what Windows Hello, Touch ID and
    security keys make.
  - **Attestation is `none`:** a key is trusted because you confirmed its
    fingerprint, not because of its make.
- **Registering a key is an approval in Pi.** Before it is stored, Pi shows the
  SHA-256 fingerprint and asks `y`. Removing one asks in Pi too. So a key cannot be
  added from the page alone.
- **The store is in Pi's agent folder.** The agent's shell does not write it; the
  review records live beside it, so a record that says "approved" was written by
  this plugin and not by a command. If the agent could write the folder, it could
  register its own key, so the folder's protection is the real guard.
- **A tampered file is not trusted, and not overwritten.** A key whose fingerprint
  is not its key's was never confirmed and is ignored; a file that cannot be read,
  is loose or is not ours trusts no key and is left for you to look at. Approval then
  falls back to the page and a `y` in Pi.
- **The fallback is the old rule.** With no passkey, or a browser without one, the
  page marks the review "approved in page" and Pi asks `y`. The record says which
  way it was given (`passkey` or `page-and-pi`), so a later gate can ask for the
  stronger one.
- **The page is opened at `localhost`.** A passkey's relying party id cannot be an
  IP address, so the link says `localhost` while the server still listens on
  `127.0.0.1` alone.
- **Approval is bound to the diff.** The challenge names the review and its diff as
  you saw it; if a new round arrived since, the approval is refused.

## 2026-10-30: jig-mongo is built on the official driver, with the walk of a pipeline as one of two locks

- **The driver is `mongodb` 7.7.0, pinned exactly (Apache-2.0).** It is the
  supported way to speak to MongoDB: its wire protocol, authentication, TLS and
  server selection are not worth rewriting, and `mongosh` would add a second
  language that runs code.
  - It was the second runtime dependency, after `yaml`. The review page added
    `hono`, `@hono/node-server` and `ignore` later.
  - It is loaded on the first call, so a session that never reads MongoDB does
    not pay for it, and only `driver.ts` imports it.
  - Its own dependencies are `bson`, `@mongodb-js/saslprep` and
    `mongodb-connection-string-url`.
- **The tool talks to a seam, not to the driver.** `Backend` is what the tool asks of a database, and `adaptClient` turns it into driver
  calls. The tool is tested with a fake of the seam, the adapter with a fake client, and one optional test uses a real server when
  `JIG_TEST_MONGO_URI` is set.
- **Results are relaxed Extended JSON.** A plain string for an id would not match an ObjectId in the next filter, so the model would
  waste calls on it. Binary data and code are shown as a note. A 64-bit integer that JSON cannot hold keeps its type: the driver's own
  relaxed form loses digits there.
- **A pipeline is walked, and with an allow list it is also reshaped.** The walk
  refuses a reference to a denied or unlisted field in every stage and
  sub-pipeline.
  - **Why reshape too:** the walk is a static check of a language with many
    corners, so with an allow list a projection of the allowed fields is put in
    front of every stage and sub-pipeline. A corner the walk missed then reads
    nothing that is not listed.
  - **Refused outright:** `$objectToArray`, because it turns field names into
    values, and `$graphLookup` with an allow list, because it cannot be limited.
  - **A name that looks denied** is refused even as the name of a new field,
    which is a small cost for a rule that is easy to state.
- **A write reports counts, so a write names no denied field.** `modifiedCount` of `{"$set": {"password": "x"}}` would tell the agent
  whether the value equals "x". Filters, updates and documents are checked like reads.
- **The preview's count is the guard.** The count is read just before the
  preview and again when the call runs, and the fingerprint covers it.
  - `limit` is the cap of a write of many (1000 by default, at most 2000), so
    one parameter keeps the meaning "how many".
  - Upserts and array filters are not supported yet: an upsert is a write whose
    count is zero.
- **A write is sent once.** The driver's `retryWrites` is off, and a lost reply is answered by one read, never by sending again.
- **The SSH route is arguments only.**
  - `-F /dev/null` leaves out ssh configuration that the agent's shell could
    have written.
  - The host and user are checked to be plain words, and the key lives in a
    private file only until ssh has signed in.
  - A forward reaches one host, so the address must be one `host:port`; the
    certificate is still checked against the database's own name.
- **A connection is never named `local` or `external`.** Writes to those are not asked about as writes to a test environment are.

## 2026-10-30: jig-mongo is a complete MongoDB tool; no SQL tool for now

- **Complete:** exploring, indexes, query plans, the full aggregation pipeline,
  and writes. `jig-core` keeps it safe: reads run, writes to a test environment
  ask with a preview that counts the documents, and production writes are
  denied.
- **Access by list:** a deny list in test environments, and an allow list in
  production, which fails closed. The lists reach fields, so an aggregation
  that names a denied field is refused before it runs. System databases and
  credential-like fields are always denied.
- **No generic SQL tool yet.** The SQL databases met so far are a company's own
  reporting stores, read through its own scripts. A `sql` tool waits until one
  is needed at more than one job.

## 2026-10-30: CI and its watches live in jig-ops, one adapter per CI system

- **`ci` is built, and `jig-git` lost `checks`.** The tool has `status`, `runs`,
  `run`, `log`, `rerun`, `trigger` and `watch`, with one adapter each for GitHub
  Actions, GitLab CI and Jenkins.
  - `jig-git` keeps git, pull requests, reviews and releases, and `pr view`
    keeps its one-line roll-up of the checks.
  - The GitHub logic, its tests and its watch moved; nothing was rewritten that
    did not have to be.
- **An adapter says what it has.** Each has a table of the actions it supports
  and the parameters each takes. An action it lacks is invalid input that names
  it, and the call is blocked before anyone is asked.
  - **GitHub Actions** has no `trigger` (a workflow can deploy, and deploys have
    their own tool).
  - **Jenkins** has no `rerun` (its API has none, and a build that took a
    password cannot be rebuilt from what it shows).
  - **GitLab** retries failed jobs only.
  - GitHub's artifact list is part of `run`, so the tool has seven actions and
    not eight.
- **The watch moved with CI.** It needs the same reads, the catalog knows the CI
  system, and two watches for one push (a GitHub one in `jig-git`, the rest in
  `jig-ops`) would report twice.
  - The kind is `ops-ci`, one for all systems.
  - The spec holds the name of the service and never its repository, address or
    job, so a poll reads where the catalog says now.
  - GitLab and Jenkins watch a pipeline or build to its end, or named jobs or
    stages.
- **A push starts a watch through an event.** `jig-git` cannot import `jig-ops`,
  and must not know who listens. It publishes `jig-git:pushed`
  (`{ repo, branch, sha, pr? }`) after a push and after a pull request.
  - `jig-ops` starts a watch for a service that has the repository and a CI
    entry.
  - The payload is checked, because anyone can publish on the bus.
  - The setting is `ops.watch.auto`.
- **"Artifact ready" is now `jig-ops:artifact-ready`.** The plugin that
  publishes an event owns its name, and `jig-git` no longer publishes this one.
  Nothing in this repository listened to the old name.
  - `git.watch` and `git.artifacts` became `ops.watch` and `ops.artifacts`; the
    `git` section says where they went.
  - The rules stay global for now, not per service.
- **The CI host is `external` unless the catalog names an environment.** Reads are
  external reads, `rerun` and `trigger` external writes that ask. A CI server that is
  production, or a name `jig-core` does not know, gets masked reads and no writes.
- **Sign-in is a token, a sign-in service or a transport.** The token is a secret
  reference (`PRIVATE-TOKEN` for GitLab; user and API token for Jenkins). Direct
  requests need `https`, a redirect is never followed, and one request path is the
  only place that holds a credential.
- **A write is sent once.** A timeout, a broken connection or a gateway error may
  mean it landed. The tool reads once (the attempt number of a run, a pipeline that
  left its finished state or a newer one on the ref, the next build number) and
  never sends again. Jenkins' crumb is asked for before the POST, so a failure there
  means nothing was sent.

## 2026-10-30: jig-api part 2: Bruno, OpenAPI and the Postman cloud, and the first dependency

- **`yaml` is the repository's first runtime dependency (2.9.1, pinned
  exactly).** Bruno's default format is YAML and OpenAPI specs are mostly YAML.
  A YAML parser is not something to write: anchors, block scalars, flow styles
  and several ways to quote.

  `yaml` (eemeli/yaml) was chosen over writing one, and over a parser that comes
  with a larger tree, because:
  - it is ISC-licensed and has no dependencies of its own, so the lock file gains one package;
  - it parses and never evaluates: no custom tag runs code, aliases are capped, duplicate keys are an error;
  - it reports a code and a position for a mistake, so a message can name the line and never quote it (a line of an environment
    may hold a secret);
  - it ships its own types.
  It is used only to parse. Nothing is `eval`ed.
- **Bruno's `.bru` language is read by a small reader of our own.** Its parser
  comes with a grammar library and a utility library, which is more than a line
  format of a few block kinds needs.
  - The reader has to keep a secret's value out of every message anyway.
  - The format is documented in Bruno's pages and its own readers, which
    `docs/not-verified.md` lists.
- **No `.env` file is ever read.** Bruno reads `{{process.env.NAME}}` from one. Here it is a secret named `process.env.NAME`, filled
  from `api.secrets` like any other, so the file that is easiest to commit by mistake is never opened.
- **OpenAPI is opt-in, per environment, and its hosts are configured.** A spec
  lists what an API can do, not what a team chose to run, and its servers rarely
  match environment names.
  - So it runs only in the environments listed in its own configuration,
    against the servers that configuration maps to them.
  - In production it runs only reads, and only with `allowProductionReads`.
    Writes in production stay denied by the floor.
- **A credential in a spec is a slot, never a value.** Each security scheme becomes secret variables named for it, filled from
  `api.secrets` or by the company's sign-in. A token address on a host that is not one of the spec's servers is refused, so a client's
  secret is not sent to a host the environment does not have.
- **Optional parameters are left out, not blanked.** A parameter or body property the spec does not require is sent only when the
  agent gives it, so a missing filter does not become an empty one.
- **Postman's cloud is fetched by a command the person types.** `/api refresh`
  fetches to a local copy, and reading stays synchronous, because a call is
  classified before it runs.
  - The fetch is an ordinary request of the sending engine, so a transport
    carries it and the key is read by `jig-core` when it is sent.
  - The copy omits the values of secret variables and is private to the user.
  - A collection access key, which goes in the address, is not used.

## 2026-10-30: jig-ops runtime and deploy, as built

- **The Kubernetes reads are the first runtime adapter,** and `jig-k8s` was never a
  plugin of its own.
- **An environment's name in the catalog is its `jig-core` name.** The reads kept a
  second table from service environments to `jig-core` environments. The catalog
  has none, so there is one name to keep right.
- **`jig-core` says what is production.** The reads listened for decision events to
  refuse a command in a pod in production, because a plugin could not ask.
  `environments.kindOf` lets `classify` refuse it, so the call is blocked before
  anyone is asked and nothing listens. A name nobody defined counts as production.
- **A call gives a version and no more.** The release, chart, values, workload,
  context, namespace and health address are the catalog's, and the health path too.
- **A command is started once.** One that is cut short has an unknown outcome: the
  rollout is read once, and the model is told not to run it again.

## 2026-10-30: jig-http becomes jig-api, and runs saved requests

- **Renamed** from `jig-http` to `jig-api`, and its tool from `http` to `api`. The plugin still sends
  HTTP, but the agent no longer types a host, a path or a header: it runs a request the team already
  saved, by name, and fills its variables.
- **Why.** Teams keep their requests in Postman, Bruno, `.http` files or an OpenAPI spec. A request
  written by a model is a request to get wrong, and an environment to reach by accident. A saved
  request cannot be mistyped, and its environment decides its host.
- **What carries over:** the sending engine and its tests: sign-in, OAuth, transports, previews that
  are tied to what is sent, and the rule that a lost reply is never resent.
- **What changed:**
  - the configuration is `api`: collections, the mapping of their environment names to `jig-core`'s,
    secret references, requests that read although their method does not, and the environments where
    an ad-hoc `call` is allowed;
  - a call's action is the request's name, so a rule can name one request;
  - a folder runs as its strictest request.
- **Requests are sent by the tool, scripts never run.** Running an API client's own CLI would run its
  scripts with the agent's variables. A request that needs a pre-request script is refused by name;
  most need none.
- **Hosts are pinned per environment,** and link-local and cloud-metadata addresses are never called.
  The environment decides where a request goes, so a saved request that names another environment's
  host cannot reach it. The agent can fill a variable, never the host.
- **Secrets come from references only.** A variable the format marks secret needs a reference in
  `api.secrets`. A plain value for it in an export is refused, with a warning that names the file,
  because exports travel by email and git.
- **Ad-hoc `call` is opt-in and never production,** asked of `jig-core`, so a company's own name for
  production counts.
- **Two parts.** Part 1 is Postman files and `.http` folders. Part 2 is Bruno, OpenAPI and a Postman
  workspace, one adapter each behind the same interface.

## 2026-10-30: jig-ops, one plugin for build, deploy and run

- **`jig-k8s` alone was too small.** The real use is the loop: the change
  built, deploy it to `staging`, check it is healthy, read the logs if not.
- **`jig-ops` covers it with three tools:** `ci`, `deploy` and `runtime`. Each
  is generic, with one small adapter per system: GitHub Actions, GitLab CI and
  Jenkins; Helm, `kubectl set image`, a GitOps pull request and a CI deploy job;
  Kubernetes first.
- **A service catalog describes each service once:** repository, CI, and per
  environment its deploy method, runtime and health address. An environment
  without a deploy method cannot be deployed to, and the floor denies
  production writes anyway.
- **CI moves here from `jig-git`,** which keeps git, pull requests, reviews and
  releases (done: see the entry above).
- **Docker comes later,** with care: access to Docker is root on the machine.

## 2026-10-30: jig-flow becomes jig-workflow, and workflows are named files

- **Renamed** to `jig-workflow`, with its tool `workflow`.
- **No workflow is built in.** Each is a JSON file with a name, stages, exit
  conditions and holds, written by you or a company plugin. You start one by
  name, or a ticket-key pattern picks it.
- **Conditions come from a fixed list** that the plugin checks itself, so a
  workflow file never runs code. A custom check belongs in a repository's test
  command.
- **Holds reach other tools through a gate in `jig-core`,** which can only make
  a decision stricter.

## 2026-10-30: no jig-scripts in the generic set

- **Dropped.** A generic user runs scripts with `bash`, in the sandbox. What a
  script tool adds (credentials outside the sandbox, a pinned folder, masked
  output files) matters only for scripts that need credentials or production
  access, which are a company's own. A company plugin can offer those as its
  own tools.

## 2026-10-30: one tool manager over every tool

`jig-core` governs every tool call through Pi's hooks: Pi's own tools, Jig's,
and other packages'. This replaces an earlier design in which each tool carried
its own safety pipeline.

**Kept**
- **Rules:** per tool and per environment, in configuration.
- **Approval screens:** they grow from yes or no, to review screens, to
  multi-question forms.
- **Secret backends:** configurable, with `pass` first.
- **Docs first:** each plugin's README is its specification.
- **Reuse over building,** when an existing package is better.

**Changed**
- **The floor.** Configuration can make anything stricter but never lower it:
  production writes stay denied, production results stay masked, and
  credentials stay hidden from `bash`. See [Permissions](permissions.md).
- **`bash`.** It is protected by the sandbox. Command rules are a convenience,
  not the protection, because a shell string can reach anything.
- **Masking and secrets.** Jig's own tools mask their results and fetch secrets
  themselves; the tool manager is the backstop for every other tool.

**Rejected**
- **A homemade password manager.** It is a liability. Every platform has a
  store with a command-line interface (see [Secrets](secrets.md)).
- **Approve buttons in a browser.** The agent could forge them. The browser
  shows; `y` inside the waiting call approves (see [Approvals](approvals.md)).
- **The database and dashboard inside `jig-core`.** They are a separate
  plugin, `jig-lens`: `jig-core` writes records and `jig-lens` reads them.
- **A homemade charts interface.** `jig-lens` uses an existing local viewer.
- **Automatic deploys after CI, beyond `staging`.** Watching CI until it
  finishes is in. A deploy can follow automatically only to a test environment
  named in policy (`staging`, for example), and only if a policy setting allows
  it; never to production.

## 2026-10-30: jig-core is our own code, and it runs the watches

- **Our own code, not built on `@gotgenes/pi-permission-system`.** Jig borrows
  its patterns (see [Reuse](reuse.md)). It is not a dependency because:
  - environments are that package's stated non-goal;
  - it judges another package's tools by name only;
  - it releases a new major version almost every month.
- **The watch engine lives in `jig-core`.** It covers polling, finish lines,
  saving, resuming and notices. Plugins share code only through `jig-core`, and
  a company plugin needs the same engine for its own CI and deploys.
- **Who starts and who stops.** A plugin starts a watch from its own tool, such
  as `checks watch` (now `ci watch`; see the entry on where CI lives). The `watch` tool
  in `jig-core` lists and stops every watch.

## 2026-10-30: a company's sign-in is a service, and its field names reach the masker

- **Sign-in is code, so `jig-core` holds it as a service.** A company plugin
  registers it by name. A tool asks for the headers of one request and never
  sees how the sign-in works.
- **Not a secret reference.** A reference names a stored value. A single
  sign-on gateway gives a short-lived token that code must fetch and renew.
- **Hidden like a secret.** `jig-core` registers every returned header value
  with the redactor, so no tool needs a redaction of its own.
- **Company field names come in through the API,** like environments and
  rules, not through `jig.json`: they describe a company's data, not a
  person's preference. A name the masker refuses is a start-up problem shown by
  `/jig`. The alternative, a masker that fails on every production result, would
  hide the cause.

## 2026-10-30, later: the lens, lighter

- **Cost, tokens and sessions come from an existing tool.** TokenTelemetry
  (MIT) reads Pi's own session logs. It shows cost per session and project,
  tool-call waterfalls and per-model analytics, on `127.0.0.1`. Run it with
  `TT_NO_TELEMETRY=1` and `TT_NO_UPDATE_CHECK=1`. Jig builds nothing for this.
- **`jig-lens` keeps what only Jig knows:** rule decisions, approvals and time
  waited, tickets and checks. `/lens` shows them as a summary inside Pi, with no
  server.
- **Grafana becomes optional,** a deep dive with `/lens grafana`. It is built,
  and it was tried on Grafana 13.3 with the SQLite plugin, but nobody needs to
  install it.
- **Rejected:**
  - AI Observer: it listens on every network interface with no login, and it
    cannot group by Jig's fields (tried in a sandbox with no network);
  - agentrecap: it declares no licence;
  - OpenObserve: a general logs, metrics and traces platform with telemetry
    on and a login.

## 2026-10-30, later: the lens summary is an entry the model never reads

- **A session entry, drawn in the chat.** `/lens` keeps its summary with
  `pi.appendEntry` and an entry renderer. Pi keeps such an entry out of the
  conversation, the terminal's scrollback and selection work, and a resumed
  session shows it again. A test runs `/lens` in a real Pi session and checks
  that nothing of it reaches the model.
- **Rejected:** a custom message (the model would read it, and every later turn
  would pay for it); a status notification (dim, and the next one replaces it);
  a panel or a widget (they take the keyboard or the space beside the editor).
- **Without a terminal:** over RPC, which has no chat to draw in, a shortened
  notification; in print and JSON modes, nothing.
- **The `viewer` setting is gone.** `/lens grafana` and `/lens datasette` name
  the viewer, so nothing else needed the setting. A `viewer` left in `jig.json`
  is reported with what replaced it.
- **Today is the user's day,** from local midnight, not a UTC day.
- **A ticket has an index and a tool does not.** No query asks for one tool's
  rows, and an index that starts with the tool made session and ticket scopes
  slower. Percentiles are made in the plugin, because SQLite has none.

## 2026-10-30: the lens reads a copy of the records

- **The records stay JSON lines,** written only by `jig-core`. Appending a line
  cannot break a tool call, and `jig-core` needs no database.
- **`jig-lens` keeps a SQLite index** of them that it can always rebuild, and
  the viewer reads only that index.
- **The viewer is Grafana with a SQLite data source:** one local process, SQL
  panels, and dashboards kept as files. Datasette is the fallback over the same
  index.
- **Grafana's sign-in stays on.** The agent's shell can reach `127.0.0.1`, and
  a Grafana data source runs any SQL it is sent.
- **Rejected: an LLM trace platform as the store.** Langfuse and Opik need
  several containers; Phoenix's licence is not open source, and its dashboards
  are fixed. An export to MLflow can come later, as a copy.

## 2026-10-30: how a watch tells the agent

- **One message per result, as a follow-up that starts a turn.** An idle agent
  wakes. A busy one reads it when its turn ends, so a message never cuts a turn
  short.
- **Combined and spaced.** Results that end within a second share a message, and
  messages are at least ten seconds apart. Every message costs the agent a turn,
  and watches tend to end together.
- **A stall is for you, not the agent.** The "still waiting" notice goes to the
  screen only. The agent has nothing to do about it.
- **A pause is for both.** Three failed polls in a row would otherwise leave the
  agent waiting for a result that is not coming.
- **A stop sends nothing,** because the agent or you asked for it.
- **The engine cleans the text itself.** A message does not pass the hook that
  cleans tool results, so a watch's summary and details are redacted and masked
  when it ends, before they are saved, sent or shown. Terminal escape codes go
  first: a hostile log can carry codes that act on the terminal.
- **A watch belongs to its session.** Only the session that started it polls it,
  even after a restart, so two sessions never report the same result.

## 2026-10-30: jig-git's tools, and a watch that knows when it is done

- **Four tools:** `git`, `pr`, `checks` and `release`. (`checks` moved to `jig-ops` as
  `ci` the same day.) They come from an
  inventory of two months of sessions plus standard needs. Most of `git` and
  `pr` is ported from the existing harness. `checks watch` starts a watch on
  `jig-core`'s engine.
- **A watch has an explicit finish line,** never "all checks". In the
  sessions, slow optional checks stayed pending for hours after the step that
  mattered had passed.
- **`jig-git` never deploys.** It published "artifact ready" (now `jig-ops` does); a
  company plugin decides, within the rule above for automatic deploys.
- **Left out:** starting workflows by hand, a raw API tool, approving pull
  requests, and destructive commands such as `reset --hard`.

## 2026-10-30: built clean, beside the existing harness

- **The existing harness is not modified for Jig work.** Its one security fix
  made during this design stays: its code-review tool no longer gives the
  agent the review page's link with its secret.
- **Jig is tried in its own Pi profile** (`PI_CODING_AGENT_DIR`) on scratch
  work. That profile borrows the existing harness's sandbox, unchanged, through
  Pi's package filter.
- **Swapping Jig plugins into daily use** is decided later, plugin by plugin.

## Earlier decisions that still hold (2026-10-29)

- **Pi only.** No Claude Code plugin.
- **Two repositories.** This public, generic `jig`, and a private company
  plugin kept at the company.
- **One approval per change** (after tests and checks, before the pull request
  is shared) is the goal for the ticket flow. It arrives with `jig-workflow`, and
  pushes keep their confirmation until then.
- **Rendered previews come with the Jira tools,** together with the PR text
  previews.

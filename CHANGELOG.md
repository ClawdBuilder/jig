# Changelog

What changed in Jig, newest first. Pi shows the entries newer than the version you had, once, after an update.

## [Unreleased]

### Added

- `approvals.openInBrowser` in `jig.json`: `"always"` opens a review screen's preview in the browser as soon as the screen appears (once per question); the default `"on-key"` keeps the `o` key.
- `workflow test` picks the JDK a Gradle build needs from its files (the wrapper's Gradle version, the build's Java level, and each installed JDK's `release` file), so no repository needs its own `JAVA_HOME`; a configured one still wins, and the result says which JDK ran and why.
- `ci` with Concourse: a job's builds, one build and its log, trigger and watch. The token comes from a credential you configure
  (such as `cmd:` reading what `fly login` saved); Jig never signs in. A paused pipeline or a job closed to manual starts is
  refused before anyone is asked.
- `jig-core` requests can stop at a marker in the reply, for a stream that never closes on its own.
- A Context panel in the Herdr app files: what fills the session's context (messages, tools, system prompt, skills, context
  files, the compaction buffer, free space), a switch for each tool and skill of that session, and Reload. `jig-session`
  writes the figures into its status file and takes the switches from a request file; `/session-reload` reloads when idle.
- A service's environment can name its own CI job (`environments.<name>.job`), and `ci` takes an `environment`: "build orders-api for staging" runs that environment's job. A write in a test environment asks; one in production is refused before asking.

### Changed

- After a push, the result says how the agent will hear when CI finishes (a running `ci` watch, or the call that starts one), and the model is told that a promise to report on CI needs a watch.
- A command that fails because the sandbox makes no Unix socket (a JVM attaching to itself, Docker, a socket tool) says so in one line, and how to run it outside with the user's approval.

### Fixed

- The `o` key on the review screen opens the preview over `http://localhost` from a small server on this machine, not as a file, so it opens in a Windows browser under WSL; it says which address it opened, and why when it could not (the launcher failed, or the server could not start and a file was used).
- The local packages Pi loads from its settings (and the extension files it loaded) are guarded: the sandboxed `bash` cannot change code that runs unsandboxed at the next start, and Pi's file tools refuse to write it.

## [0.2.0] - 2026-11-02

### Added

- `startChecks` in `jig.json`: hosts to reach when a session starts, such as one behind a VPN. One notice for each that does not
  answer; nothing is retried or started.
- `secrets.pass.unlockAtStart`: the password store is unlocked when a session starts, by its own passphrase prompt, so a task is
  not interrupted later.
- `secrets.pass.storeDir` and `gnupgHome`: where `pass` looks, bound in `jig.json` whatever starts Pi.
- `bin/pi`, an optional launcher: Pi inside tmux outside herdr, and reattach to a Pi still running in this folder.
- `jira search` with `commented: { by, from, to }`: the issues someone commented on in a period, exactly.
- `/lens compare`, roles for child agents, and guards that keep the repository's checks honest.

### Changed

- Tested with Pi 1.5.0. Tool parameters that are one of some strings are built by `jig-core`'s `stringEnum`, which reads the
  same on every Pi.
- Pi's extension list names each plugin (`jig-core`), not `jig-core/src`.
- The review offered after a run shows what the agent did, not what a merge, pull or rebase brought in.
- An approval screen tells the terminal that Pi waits for permission, so a terminal app that lists agents shows it as waiting.

### Fixed

- A password store or key ring moved by `PASSWORD_STORE_DIR`, `GNUPGHOME` or another credential variable is hidden from `bash`
  and Pi's file tools, as the usual folders are.

## [0.1.0] - 2026-10-31

- The first set of plugins: `jig-core`, `jig-sandbox`, `jig-memory`, `jig-workflow`, `jig-agents`, `jig-git`, `jig-lens`,
  `jig-jira`, `jig-logs`, `jig-api`, `jig-ops`, `jig-review`, `jig-mongo` and `jig-theme`.

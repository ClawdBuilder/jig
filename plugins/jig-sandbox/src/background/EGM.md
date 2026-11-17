# jig-sandbox/src/background

## Overview

Background tasks of `jig-sandbox`: long-running sandboxed commands the agent starts with `bash` (`background: true`),
reads with `bg_output`, lists with `bg_list` and stops with `bg_kill`, and that you see and stop with `/ps`. A `Tasks`
registry owns each task's process, rotating log, patterns, deadline and wake-up messages, and stops everything when the
session ends. The idea, paging helpers and log layout are adapted from `pi-bg-bash` (MIT; notice in
[LICENSE-pi-bg-bash](../../docs/LICENSE-pi-bg-bash)). Tools, limits and waking: [background tasks](../../docs/background-tasks.md);
file roles: [code map](../../docs/code-map.md). Parent: [src](../EGM.md).

## Interface

- **`tools.ts`**: `backgroundProperties()` (the `background`, `name`, `notifyOn` parameters `bash` merges into its schema),
  `backgroundProblem(params)`, `startBackground(tasks, params, ctx, signal)`, `backgroundTools(tasks)` (the `bg_output`,
  `bg_list`, `bg_kill` definitions). `bg_output` takes `{ id, tail?, offset?, filter? }`, `tail` 1..500 and exclusive with `offset`.
- **`declarations.ts`**: `backgroundDeclarations()`: `bg_output` and `bg_list` are local reads, `bg_kill` a local write.
- **`tasks.ts`**: class `Tasks` (`sessionStart`, `setContext`, `onMessageStart`, `onChange`, `get`, `requireTask`, `list`,
  `running`, `start`, `stop`, `kill`, `clearFinished`, `shutdown`, `cleanOrphans`, and a `notifier`), `LOG_SEGMENT_BYTES` (4 MiB).
- **`tasks-deps.ts`**: types `TasksDeps`, `StartRequest`, `StopReport`. **`types.ts`**: `Task`, `TaskState` (`running`,
  `exited`, `killed`, `failed`), `KillReason` (`by agent`, `by user`, `max runtime`, `session end`), `NotifyOn`, `StopOutcome`.
- **`task-record.ts`**: `runningTask`, `failedTask`. **`capture.ts`**: `captureOutput`, `LineEndings`.
  **`after-end.ts`**: the audit and explanation once a process is gone.
- **`patterns.ts`**: `patternProblem`, `screenPatterns`, `LineMatcher`, `MAX_PATTERNS` (5), `MAX_PATTERN_CHARS` (200).
- **`notify.ts`**: `Notifier`, `WAKE_TYPE` (`jig-sandbox-background`), `NOTE_TYPE` (`jig-sandbox-background-note`),
  `DEFAULT_TIMING`.
- **`logfile.ts`**: `TaskLog`, `countLines`. **`output.ts`**: `readOutput`, `tailText`, `IDLE_MS`.
  **`format.ts`**: shared wording (`taskLine`, `stateText`, `describeStop`, ...).
- **`process.ts`**: `ProcessPort`, `realPort`, `terminate(pid, ageMs, deps)`, `parseStat`, `GRACE_MS` (3 s).
- **`sessions.ts`**: `backgroundRoot`, `sessionFolder`, `ensureSessionFolder`, `writeManifest`, `writeOwner`, `cleanupSessions`,
  `removeSessionFolder`, `OWNER_FILE`, `MANIFEST_FILE`. **`env.ts`**: `buildTaskEnv`. **`ps.ts`**: `registerPs`, `psCommand`, `logView`.

## Invariants

- **Task states are exactly** `running`, `exited`, `killed`, `failed`. `failed` is a task whose process could not be created
  (kept so `bg_list` can say why). `stop()` is idempotent: it keeps the first kill reason and the single terminate promise.
- **Limits.** Start is refused at `background.maxTasks` running (default 4). Every task has a deadline: its timeout, cut to
  `background.maxRuntimeMinutes` (default 240). Finished tasks are evicted past `background.keepFinished` (12), oldest first.
- **Interactive sessions only.** `print` and `json` modes refuse; `outside: true` with `background` is refused and nobody is
  asked; `name` or `notifyOn` without `background: true` is an error. A sandbox that is off or failed to start throws at start.
- **Patterns are checked before the task starts,** and a refused pattern means no task: at most 5 per kind, 200 characters,
  no control characters, no back-references, look-behind, nested repeats or repeat count over 1,000 (`a{1,100000}`), valid regex,
  never matching the empty string. Matched per line on the first 4,096 bytes; a line without a newline is matched after 500 ms of quiet.
- **The shell leads its own process group** (`detached: true`), so its pid is the group id. `process.ts` is the only contact
  with signals and `/proc`; keep new process contact behind `ProcessPort` so tests can fake it.
- **Stop order.** SIGTERM goes to every inner process group first (never to the outer group while an inner one exists,
  or the outer bubblewrap would die before any trap ran); after the 3 s grace, SIGKILL to the outer group and the inner ones.
  Signals to a pid of 1 or less are refused. Identity is pid plus start ticks, so a reused pid is never signalled by clean-up.
- **Output is cleaned before it is logged or matched:** no terminal control sequences, no credential values, one cleaner
  per stream so a sequence cut between chunks is rejoined. Offsets count cleaned bytes and stay valid after rotation.
- **The log is two segments** (`bg-N.log` and `bg-N.log.1`, 4 MiB each); rotation drops the older one and writes a header
  line that is not counted in offsets. A write error stops logging, not the task. Files open with `wx`, mode 0600.
- **Clean-up is by owner liveness, never by age.** A session folder with no readable `owner.pid`, or whose owner is alive
  with the same start ticks, or the current session's, is left alone. Only the known file names are removed.
- **Session end** stops every task (term, kill, with a 5 s cap), closes logs and removes the session folder. Quit, a new
  session and reload all end the tasks.
- **Waking is bounded:** events are `exit`, `ready` (once) and `error` (3 per task, 30 s apart); a burst is one message
  after 1 s; a wake whose line the agent already read with `bg_output` is dropped; `background.wake: "off"` sends without waking.
- **A task the agent stops itself wakes nothing;** `/ps` kills give the agent one line without waking it.

## Side Effects

- **Disk.** `<agentDir>/jig-sandbox/background/<session>/` (0700, name sanitised to `[A-Za-z0-9._-]`, 80 characters) holds
  `bg-N.log[.1]`, `owner.pid` and `manifest.json` (running tasks only), all 0600. `owner.pid` and `manifest.json` are replaced
  durably (synced, renamed); logs are appended with plain writes and never synced. The sandbox locks this folder so a command
  cannot swap a log for a link. Removed at session end and by orphan clean-up.
- **Processes.** Spawns the wrapped command (`TasksDeps.shell()`, environment from `buildTaskEnv`), `detached`, stdio
  `ignore`/`pipe`/`pipe`. Reads `/proc`; on macOS runs `ps -o lstart= -p <pid>`. Sends SIGTERM, SIGKILL and signal 0.
- **Timers.** A deadline timer per task, a 200 ms stdio-grace timer, the 5 s shutdown cap, the notifier's 1 s flush timer and
  60 s in-flight timer (after one wake message no further one goes until `message_start` or 60 s pass), a matcher idle timer, and
  the 1 s refresh interval of the `/ps` log view. The error gap (30 s) is a clock comparison, not a timer.
- **Pi.** `pi.sendMessage` with the two custom types above; `pi.events.emit("jig-theme:segment", ...)` for the footer count;
  registers `/ps`. Calls the localhost bridge (`taskStarted`, `taskEnded`) in `filtered` and `ask` modes.
- **Aftermath.** After a task ends, the audit undoes what it planted and `[sandbox]` lines go into the end message.
- **Environment.** `buildTaskEnv` finds the `PATH` key by name and puts `<agentDir>/bin` first; it deletes `PI_SESSION_ID`,
  `PI_SESSION_FILE`, `PI_PROVIDER`, `PI_MODEL` and `PI_REASONING_LEVEL` from the base environment and sets them again from Pi's
  context. Settings come from the `sandbox.background` section of `jig.json`.

## Verification

- Run from the repository root: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/*.test.ts"`
- Narrower: `node --import ./test/support/host.mjs --test "plugins/jig-sandbox/test/background*.test.ts"`
- Needs `bwrap`, `socat`, `rg` and `python3` for the real-sandbox tests; they skip with a reason when missing.
- Docs: `node scripts/check-docs.mjs`

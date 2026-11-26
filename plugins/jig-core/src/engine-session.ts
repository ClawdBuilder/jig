// The life of a session in the engine: `start` reads the settings, `beginSession` does what a session start does once, and `stop`
// ends it. These were `startSession` and the `session_shutdown` handler of `index.ts` before the engine existed; what is about
// Pi itself (its skills list, its session profile, its deferred tools, its sandbox notice, its screen) stays in Pi's adapter.
import { cleanupSpill } from "./cap.ts";
import { loadPersonalConfig } from "./engine-state.ts";
import type { JigState } from "./engine-state.ts";
import type { EngineHost } from "./engine.ts";
import { offSectionsOf } from "./plugin-table.ts";
import { cleanupPreviews } from "./preview-html.ts";
import { cleanupRecords } from "./records.ts";
import { startJobs } from "./start-jobs.ts";

/**
 * Before the first call: keeps the host, and reads jig.json with the sections the plugins registered, less those the host says are
 * off. The rules are built from what it read when they are first asked for, as before. It writes nothing and calls nothing outside;
 * a hook may call it in every run.
 */
export function start(state: JigState, host: EngineHost): void {
    state.host = host;
    state.sessionId = host.session.id;
    state.workingDir = host.cwd;
    // A section kept in jig.json for a plugin that did not load is off, not an unknown field. The host may say which are off
    // (`EngineOptions.offSections`); else it is the built-in plugins' sections that no registered section covers (src/plugin-table.ts).
    state.offSections = state.hostOffSections ?? offSectionsOf(state.sectionChecks.keys());
    loadPersonalConfig(state);
}

/**
 * What a session start does once: saved watches start again, the start jobs go on in the background, and old records, spill
 * files and preview pages are removed. A hook never calls it: done before every tool call, it would poll watches and delete
 * files each time.
 */
export function beginSession(state: JigState): void {
    // Watches saved by this session before the host was closed start polling again.
    if (state.sessionId !== undefined) state.watches.begin(state.sessionId);
    // In the background: the session does not wait for it, and it cannot fail the start.
    startJobs(state);

    // Old records, spill files and preview pages are removed when a session starts.
    const { config } = state.personal;
    for (const clean of [
        () => cleanupRecords(config.records.retentionDays, state.now()),
        () => cleanupSpill(config.spill.retentionDays, state.now().getTime()),
        () => cleanupPreviews(config.spill.retentionDays, state.now().getTime()),
    ]) {
        try {
            clean();
        } catch {
            // Cleaning up is a courtesy; a session should still start.
        }
    }
}

/** Once, when the session ends: forgets this session's answers and open calls, stops the watches and closes the page server. Safe to run twice. */
export async function stop(state: JigState): Promise<void> {
    state.sessionAllows.clear();
    state.calls.clear();
    state.watches.end();
    state.startJobs?.abort();
    state.startJobs = undefined;
    state.screen = undefined;
    state.models = undefined;
    // The preview server listens only while previews are being read.
    await state.previews.close().catch(() => undefined);
}

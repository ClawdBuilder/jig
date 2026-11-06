// What a session start sets going in the background: the store unlock (`secrets.pass.unlockAtStart`) and the start checks
// (`startChecks`). Both are the user's settings in `jig.json`, run here so they work however Pi was started.
//
// They run only in the top-level interactive session. With no screen (print or RPC mode without a UI) there is nobody to
// tell, and a child agent is one of many that a parent started: ten of them must not each raise a passphrase prompt or
// probe the VPN host. Nothing here is awaited by the session start, and nothing here can fail it.
import { effectiveBackends } from "./config.ts";
import type { JigState } from "./state.ts";
import { describeFailure } from "./start-checks.ts";
import { unlockStoreAtStart } from "./start-unlock.ts";
import { checkUpdateAtStart } from "./update-notice.ts";

/** Whether this Pi was started by another Pi's `jig-agents`. `PI_SUBAGENT_ID` is the variable it sets, as `jig-agents`,
 *  `jig-theme` and `jig-review` read it; `PI_SUBAGENT_CHILD=1` is the older name of the same marker. */
export function isChildAgent(env: NodeJS.ProcessEnv): boolean {
    return (env.PI_SUBAGENT_ID ?? "").trim() !== "" || env.PI_SUBAGENT_CHILD === "1";
}

/** `secrets.pass.unlockAtStart` is on, and `pass` is a backend that may resolve a reference. */
function wantsUnlock(state: JigState): boolean {
    const { secrets } = state.personal.config;
    return secrets.pass.unlockAtStart === true && effectiveBackends(secrets, state.company).on.includes("pass");
}

/** Starts the background work, if this session is the kind that runs it. Safe to call again: the earlier work is stopped. */
export function startJobs(state: JigState): void {
    state.startJobs?.abort();
    state.startJobs = undefined;
    // `screen` is set only when the session has a UI.
    if (state.screen === undefined || isChildAgent(state.env)) return;
    const control = new AbortController();
    state.startJobs = control;
    const notify = (message: string, level: "info" | "warning"): void => {
        if (control.signal.aborted) return;
        try {
            state.screen?.notify(message, level);
        } catch {
            // The screen of a session that has ended: nobody to tell.
        }
    };
    if (wantsUnlock(state)) {
        void unlockStoreAtStart({
            secrets: state.secrets,
            notify,
            now: () => state.now().getTime(),
            signal: control.signal,
        });
    }
    void checkUpdateAtStart(state, notify);
    const { startChecks } = state.personal.config;
    if (startChecks.length > 0) {
        void state.startChecks
            .run(startChecks, (check) => notify(describeFailure(check), "warning"), control.signal)
            .catch(() => undefined);
    }
}

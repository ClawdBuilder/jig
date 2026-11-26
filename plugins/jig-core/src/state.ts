// What jig-core keeps while Pi runs: the engine's state (`engine-state.ts`) with what only Pi has added to it: the agent itself, the
// screens that ask a question, the list of tools Pi has active and a host for what happens between events. The hooks in `gate.ts`
// and `results.ts` and the API in `api.ts` all work on this object. The names of the engine's state are exported from here as
// well, where callers have always found them.
//
// A new object is made every time Pi loads the extension (start-up, reload, a new session), so nothing here outlives
// its runtime.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createApprovals } from "./approvals.ts";
import type { Approvals } from "./approvals.ts";
import type { Preview } from "./contract.ts";
import { createEngine } from "./engine.ts";
import type { EngineOptions, JigState } from "./engine-state.ts";
import { readThemePreference } from "./kit/theme-preference.ts";
import { loadedExtensionFiles } from "./loaded-code.ts";
import { piHost } from "./pi-host.ts";
import { openPreview } from "./preview-html.ts";

export { MAX_OPEN_CALLS, ensureConfigLoaded, loadPersonalConfig, rememberCall } from "./engine-state.ts";
export type { CallState, JigState } from "./engine-state.ts";

/** What a test (or an embedding program) can replace. A real Pi session uses the defaults. */
export interface JigCoreOptions extends EngineOptions {
    /** Shows the rendered preview in the browser. The default serves the page on `localhost` and opens that address. */
    openPreview?: (preview: Preview, header: string) => Promise<string>;
}

/** The engine's state, with Pi's side of it. */
export interface PiState extends JigState {
    pi: ExtensionAPI;
    /** The screens that ask a question, on the queue the engine's state holds. */
    approvals: Approvals;
}

export function createState(pi: ExtensionAPI, options: JigCoreOptions = {}): PiState {
    // One object: what the engine builds keeps pointing at it, so what Pi adds below is part of it.
    const state = createEngine({ ...options, extensionFiles: () => loadedExtensionFiles(pi) }).state as PiState;
    state.pi = pi;
    state.activeTools = () => pi.getActiveTools?.();
    state.approvals = createApprovals({
        inTurn: state.approvals.inTurn,
        now: () => Date.now(),
        openPreview:
            options.openPreview ??
            ((preview, header) =>
                openPreview(preview, header, {
                    server: state.previews,
                    env: state.env,
                    theme: readThemePreference(state.agentDir()) ?? state.personal.config.ui.theme,
                })),
        openInBrowser: () => state.personal.config.approvals.openInBrowser,
    });
    // Between events, until a session starts and gives its own: a watch can fire with no event to hand a context.
    state.host = piHost(state);
    return state;
}

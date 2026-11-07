// jig-core: the tool manager. It sits over every tool call, whoever wrote the tool, through Pi's hooks:
//
//   session_start        read jig.json, resume the watches, activate tool_search when a Jig tool is deferred
//                        (src/tool-exposure.ts), and set the start-up work going (src/start-jobs.ts)
//   before_agent_start   the skill list of the turn: merged skills of the active company, none of a dormant one's (src/profile-state.ts)
//   tool_call            classify the call, decide allow / ask / deny, ask the user if a rule says so
//   tool_result          redact secrets, mask production data, cut very long output
//   tool_execution_end   write the call's record
//   turn_end             write the model turn's record
//
// It also runs the watch engine (src/watch) and registers the `watch` tool.
//
// The factory only registers things. It starts nothing long-lived (Pi's documentation forbids it): the configuration is
// loaded when the session starts.
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { agentDirFor } from "./kit/theme-preference.ts";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { buildApi } from "./api.ts";
import { publishJig, withdrawJig } from "./client.ts";
import { cleanupSpill } from "./cap.ts";
import { registerCommands, sandboxLine } from "./commands.ts";
import { describeProblem } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { gate } from "./gate.ts";
import { configFile } from "./paths.ts";
import { cleanupPreviews } from "./preview-html.ts";
import { cleanupRecords, conditionProblem } from "./records.ts";
import { finishCall, finishTurn, toolResult } from "./results.ts";
import { beforeTurn, loadedSkills, syncSkills } from "./profile-state.ts";
import { registerProfileCommand, restoreSessionProfile } from "./profile-command.ts";
import { startJobs } from "./start-jobs.ts";
import { settleDeferredTools } from "./tool-exposure.ts";
import { createState, loadPersonalConfig } from "./state.ts";
import type { JigCoreOptions, JigState } from "./state.ts";
import { registerWatchTool } from "./watch/tool.ts";

export type { JigCoreOptions };

/** The extension, with parts a test can replace (the masker, the browser). Pi loads the default export below. */
/** The state of the jig-core runtime loaded in this process, for tests that drive the whole extension. */
let running: JigState | undefined;
export function runningJigState(): JigState | undefined {
    return running;
}

export function jigCore(options: JigCoreOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        const state = createState(pi, options);
        state.configPath = () => configFile(getAgentDir());
        state.agentDir = () => agentDirFor();
        running = state;
        const api = buildApi(state);
        const badCondition = conditionProblem(process.env);
        if (badCondition !== undefined) state.startupProblems.push(badCondition);

        pi.on("session_start", (_event, ctx) => startSession(state, ctx));
        pi.on("before_agent_start", (event) => {
            beforeTurn(state, event.systemPromptOptions);
        });
        pi.on("tool_call", (event, ctx) => gate(state, event, ctx));
        pi.on("tool_result", (event, ctx) => toolResult(state, event, ctx));
        pi.on("tool_execution_end", (event, ctx) => finishCall(state, event, ctx));
        pi.on("turn_end", (event, ctx) => finishTurn(state, event, ctx));
        pi.on("session_shutdown", async () => {
            // Safe to run twice: cancellation, reload and exit can all arrive here.
            withdrawJig(api);
            if (running === state) running = undefined;
            state.sessionAllows.clear();
            state.calls.clear();
            state.watches.end();
            state.startJobs?.abort();
            state.startJobs = undefined;
            state.screen = undefined;
            // The preview server listens only while previews are being read.
            await state.previews.close().catch(() => undefined);
        });
        registerCommands(pi, state);
        registerProfileCommand(pi, state);
        registerWatchTool(pi, api, state.watches);

        // Last, so the hooks are in place before other plugins start declaring their tools. A plugin whose start-up
        // callback throws must not take the tool manager, or the other plugins, down with it: the error is kept
        // for `/jig`.
        for (const error of publishJig(api)) {
            state.startupProblems.push(`a plugin failed while loading: ${errorMessage(error)}`);
        }
    };
}

function startSession(state: JigState, ctx: ExtensionContext): void {
    state.sessionId = ctx.sessionManager.getSessionId();
    state.screen = ctx.hasUI ? ctx.ui : undefined;
    state.workingDir = ctx.cwd;
    // `/profile <name>` of this session, kept in the session file so that a reload or a resume keeps it.
    state.profile.session = restoreSessionProfile(ctx);
    loadPersonalConfig(state);
    // The merged skills of the active company (its overlays laid under the generic skills); the prompt's list is edited each turn.
    syncSkills(state, loadedSkills(state));
    // Watches saved by this session before Pi was closed start polling again.
    state.watches.begin(state.sessionId);

    const problems = [...state.policy().problems.map(describeProblem), ...state.startupProblems];
    if (problems.length > 0 && ctx.hasUI) {
        const shown = problems.slice(0, 5).join("\n");
        const more = problems.length > 5 ? `\n... and ${problems.length - 5} more (see /jig)` : "";
        ctx.ui.notify(
            `jig-core: ${problems.length} configuration problem${problems.length === 1 ? "" : "s"}\n${shown}${more}`,
            "error",
        );
    }

    announceSandbox(state, ctx);
    // Deferred Jig tools are found with Pi's tool_search, which Pi registers inactive.
    try {
        settleDeferredTools(state, ctx);
    } catch {
        // The tools stay as they are: a larger context, not a broken session.
    }
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

/**
 * Says whether `bash` is sandboxed, and in which network mode. A sandbox plugin starts after this, so its state is read
 * once it says it is ready; with none registered, the warning comes at once.
 */
function announceSandbox(state: JigState, ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const provider = state.sandbox;
    const say = (): void => {
        try {
            const line = sandboxLine(state);
            ctx.ui.notify(line, line.startsWith("bash: sandboxed") ? "info" : "warning");
        } catch {
            // The screen of a session that has ended; there is nobody to tell.
        }
    };
    if (provider?.whenReady === undefined) say();
    else provider.whenReady().then(say, say);
}

export default jigCore();

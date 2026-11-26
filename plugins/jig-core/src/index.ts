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
import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import { agentDirFor } from "./kit/theme-preference.ts";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { buildApi } from "./api.ts";
import { publishJig, withdrawJig } from "./client.ts";
import { registerCommands, sandboxLine } from "./commands.ts";
import { describeProblem } from "./config.ts";
import { errorMessage } from "./errors.ts";
import { engineOf } from "./engine.ts";
import { gate } from "./gate.ts";
import { configFile } from "./paths.ts";
import { piHost } from "./pi-host.ts";
import { conditionProblem } from "./records.ts";
import { classifyCodemode, codemodeAsk } from "./codemode.ts";
import { finishCall, finishTurn, toolResult } from "./results.ts";
import { beforeTurn, syncSkills } from "./profile-state.ts";
import { loadedSkills, registerProfileCommand, restoreSessionProfile } from "./profile-command.ts";
import { settleDeferredTools } from "./tool-exposure.ts";
import { createState } from "./state.ts";
import type { JigCoreOptions, PiState } from "./state.ts";
import { registerWatchTool } from "./watch/tool.ts";

export type { JigCoreOptions };

/** The extension, with parts a test can replace (the masker, the browser). Pi loads the default export below. */
/** The state of the jig-core runtime loaded in this process, for tests that drive the whole extension. */
let running: PiState | undefined;
export function runningJigState(): PiState | undefined {
    return running;
}

export function jigCore(options: JigCoreOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        const state = createState(pi, {
            ...options,
            configPath: () => configFile(getAgentDir()),
            agentDir: () => agentDirFor(),
        });
        state.piVersion = VERSION;
        running = state;
        const api = buildApi(state);
        const badCondition = conditionProblem(process.env);
        if (badCondition !== undefined) state.startupProblems.push(badCondition);

        let codemodeReady = false;
        const installCodemode = (): void => {
            if (codemodeReady) return;
            try {
                if (!pi.getAllTools().some((tool) => tool.name === "codemode")) return;
            } catch {
                return;
            }
            // The script decides whether the call is a plain read or can reach models; the gate says why it asks.
            api.declareTool({ tool: "codemode", plugin: "jig-core", classify: classifyCodemode });
            api.gates.register({ name: "codemode-models", plugin: "jig-core", check: codemodeAsk });
            codemodeReady = true;
        };
        pi.on("session_start", (_event, ctx) => {
            installCodemode();
            startSession(state, ctx);
        });
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
            await engineOf(state).stop();
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

function startSession(state: PiState, ctx: ExtensionContext): void {
    const engine = engineOf(state);
    state.screen = ctx.hasUI ? ctx.ui : undefined;
    state.models = ctx.modelRegistry;
    // `/profile <name>` of this session, kept in the session file so that a reload or a resume keeps it.
    state.profile.session = restoreSessionProfile(ctx);
    // The session id, the working folder and jig.json, with the sections of the plugins that are loaded.
    engine.start(piHost(state, ctx));
    // The merged skills of the active company (its overlays laid under the generic skills); the prompt's list is edited each turn.
    syncSkills(state, loadedSkills(state.pi));

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
    // Saved watches, the background start jobs, and the removal of old records, spill files and preview pages.
    engine.beginSession();
}

/**
 * Says whether `bash` is sandboxed, and in which network mode. A sandbox plugin starts after this, so its state is read
 * once it says it is ready; with none registered, the warning comes at once.
 */
function announceSandbox(state: PiState, ctx: ExtensionContext): void {
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

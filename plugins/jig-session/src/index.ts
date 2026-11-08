// Pi entry point of jig-session. It publishes the live session's state as one status file per session, for any program to
// read: which terminal the session runs in, its model, context, ticket, workflow stage, the files it changed and its recent
// tool calls (the README specifies the file). It writes files only: nothing listens on a port, nothing is sent anywhere, and
// no argument value or secret is written.
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { jig } from "../../jig-core/src/client.ts";
import { JIG_EVENTS } from "../../jig-core/src/contract.ts";
import type { ContextHost } from "./context.ts";
import { ContextView } from "./context.ts";
import { buildReport, showContext } from "./context-command.ts";
import { stateDir } from "./files.ts";
import { SWITCHES_ENTRY } from "./requests.ts";
import { StatusFile, terminalOf } from "./status.ts";
import type { Sources } from "./status.ts";

/** The command the Context panel's Reload runs, through `pi.sendUserMessage`, when Pi is idle. */
export const RELOAD_COMMAND = "session-reload";

/** The parts a test replaces. */
export interface SessionOptions extends Partial<Sources> {
    /** How often the cheap check runs, in ms; 0 turns it off (a test then calls `tick`). Default 2000. */
    tickMs?: number;
    /** Receives the status file's handle, for a test. */
    onStatus?: (status: StatusFile) => void;
    /** Replaces the parts of Pi the Context part uses, for a test. */
    contextHost?: Partial<ContextHost>;
}

/** A section of jig.json as jig-core loaded it; undefined without jig-core or without the section. */
function section(name: string): unknown {
    try {
        return jig().config.section(name);
    } catch {
        return undefined;
    }
}

/** A child that `jig-agents` (or another subagent extension) started runs in its parent's terminal, so it writes nothing. */
const isChild = (env: NodeJS.ProcessEnv): boolean =>
    (env.PI_SUBAGENT_ID?.trim() ?? "") !== "" || env.PI_SUBAGENT_CHILD === "1";

/** The extension, with parts a test can replace. Pi loads the default export below. */
export function session(options: SessionOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        const env = options.env ?? process.env;
        if (isChild(env)) return;
        const context = new ContextView({
            allTools: () => pi.getAllTools(),
            activeTools: () => pi.getActiveTools(),
            setActiveTools: (names) => pi.setActiveTools(names),
            commands: () => pi.getCommands(),
            settings: () => pi.getSettings(),
            save: (saved) => pi.appendEntry(SWITCHES_ENTRY, saved),
            reload: () => pi.sendUserMessage(`/${RELOAD_COMMAND}`, { expandPromptTemplates: true }),
            ...options.contextHost,
        });
        const status = new StatusFile({
            env,
            stateDir: options.stateDir ?? (() => stateDir(env)),
            agentDir: options.agentDir ?? (() => getAgentDir()),
            section: options.section ?? section,
            tools: options.tools ?? (() => ({ active: pi.getActiveTools().length, total: pi.getAllTools().length })),
            thinking:
                options.thinking ??
                (() => {
                    try {
                        return pi.getThinkingLevel();
                    } catch {
                        return null;
                    }
                }),
            now: options.now ?? (() => new Date()),
            context,
        });
        options.onStatus?.(status);

        // `/session-file`: where this session's status file is, and the terminal it names.
        pi.registerCommand("session-file", {
            description: "Where this session's status file is, and the terminal it names",
            handler: async (_args, ctx) => {
                const where = status.path ?? "none: no session has started";
                const { terminal, terminalFrom } = terminalOf(env);
                const term = terminal ? `terminal ${terminal} (${terminalFrom})` : "no terminal known";
                ctx.ui.notify(`jig-session: status file ${where}; ${term}`, "info");
            },
        });

        // `/context`: the Context panel's breakdown in the terminal, with tool ownership and Jig's own messages.
        pi.registerCommand("context", {
            description: "What fills this session's context, part by part, with tools and Jig's messages",
            handler: async (_args, ctx) => {
                try {
                    const detail = context.detail(ctx);
                    const model = ctx.model ? (ctx.model.name ?? ctx.model.id) : "no model";
                    let tools: ReadonlyArray<{ readonly tool: string; readonly plugin: string }> | undefined;
                    try {
                        tools = jig().tools?.declared();
                    } catch {
                        tools = undefined;
                    }
                    const declared = new Map((tools ?? []).map((entry) => [entry.tool, entry.plugin] as const));
                    await showContext(
                        ctx,
                        buildReport({
                            detail,
                            model,
                            jigLoaded: tools !== undefined,
                            declared,
                            deferred: context.deferred(),
                            entries: ctx.sessionManager.getBranch(),
                        }),
                    );
                } catch (error) {
                    ctx.ui.notify(
                        `Context could not be read: ${error instanceof Error ? error.message : String(error)}`,
                        "warning",
                    );
                }
            },
        });

        // `/session-reload`: Pi's reload, as a command an extension may run. The Context panel's Reload asks for it through the
        // request file; the session runs it when the agent is idle (a reload needs a command's context, and an idle Pi).
        pi.registerCommand(RELOAD_COMMAND, {
            description:
                "Reload extensions, skills, prompts and context files once the agent is idle (the Context panel's Reload)",
            handler: async (_args, ctx) => {
                await ctx.waitForIdle();
                await ctx.reload();
            },
        });

        // A skill switched off is left out of the prompt from the next turn, for this session only.
        pi.on("before_agent_start", (event) => {
            context.beforeTurn(event.systemPromptOptions);
        });

        // jig-core publishes a decision for every call it governs; listened to from the start, so none is missed.
        pi.events.on(JIG_EVENTS.decision, (event) => {
            if (status.activity.decided(event)) status.write();
        });

        pi.on("session_start", (event, ctx: ExtensionContext) =>
            status.start(ctx, options.tickMs ?? 2000, (event as { reason?: string }).reason),
        );
        pi.on("session_shutdown", (event) => status.stop((event as { reason?: string }).reason === "reload"));
        pi.on("agent_start", () => status.setBusy(true));
        pi.on("agent_settled", (_event, ctx) => {
            status.setBusy(false);
            status.refresh(ctx);
            try {
                context.settled(); // a reload asked while the agent worked
            } catch {
                // Pi refused: the outcome still says waiting
            }
        });
        pi.on("turn_end", (_event, ctx) => status.refresh(ctx));
        pi.on("model_select", (_event, ctx) => status.refresh(ctx));
        pi.on("thinking_level_select", () => {
            status.write();
        });
        pi.on("session_compact", (_event, ctx) => status.refresh(ctx));
        pi.on("session_tree", (_event, ctx) => status.refresh(ctx));
        pi.on("tool_execution_start", (event) => {
            status.activity.started(event.toolCallId, event.toolName);
            status.write();
        });
        // A throwing tool_call handler blocks the call, so this one never throws: it only notes a file tool's path.
        pi.on("tool_call", (event, ctx) => {
            try {
                status.activity.called(event.toolCallId, event.toolName, event.input, ctx.cwd);
            } catch {
                // no output recorded for this call
            }
        });
        pi.on("tool_execution_end", (event) => {
            status.activity.ended(event.toolCallId, event.toolName, event.isError);
            status.write();
        });
    };
}

export default session();

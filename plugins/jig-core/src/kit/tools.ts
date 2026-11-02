// Registering a Jig tool with Pi, deferred when the user asks for it. Every plugin registers its tools through
// `registerJigTool` instead of `pi.registerTool`, so `tools.deferred` in `jig.json` can keep a tool's description out
// of the model's context until Pi's `tool_search` finds it.
//
// A plugin registers its tools when Pi loads it, before `jig.json` is read and before a company plugin has given its
// defaults. So the tool is registered as it always was (direct, active), and at session start, once the configuration is
// known, a tool named in `tools.deferred` is registered again with `exposure: "deferred"` and taken out of the active set
// (Pi's "Tool Exposure": a deferred tool is not declared to the model; `tool_search` finds it and activates it). A deferred
// tool that this session's transcript shows active (`tool_search` loaded it before a resume or a reload) stays active.
//
// Pi's own tools (`read`, `bash`, `edit`, `write` and the rest) are never deferred, and neither is any tool while Pi has no
// `tool_search` to find it: the model could not reach it at all. jig-core activates `tool_search` at session start when a
// Jig tool is deferred (src/tool-exposure.ts).
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { jig } from "../client.ts";

/** The `jig.json` section that holds `deferred`. jig-core checks it; a company plugin may give defaults for it. */
export const TOOLS_SECTION = "tools";

/** Pi's tool that finds and activates deferred tools (its built-in extension `builtin:tool-search`). */
export const TOOL_SEARCH = "tool_search";

/** Tools that are never deferred: Pi's own, the file tools and `bash` (which `jig-sandbox` replaces), and the finders. */
export const NOT_DEFERRABLE: ReadonlySet<string> = new Set([
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "powershell",
    "codemode",
    TOOL_SEARCH,
]);

interface Slot {
    tools: Map<string, ToolDefinition>;
    /** After the first session start of this runtime (a reload makes a new `pi`, so a new slot): a tool registered now
     *  (again) gets its exposure at once. Only a session start hooks in, so the plugin's own handlers are all it has. */
    started: boolean;
}

/** One slot per plugin: Pi gives each extension its own `pi`. */
const slots = new WeakMap<ExtensionAPI, Slot>();

/** The names in `tools.deferred`, as jig-core read them; empty when jig-core is not loaded or the section is not there. */
export function deferredToolNames(): Set<string> {
    let section: unknown;
    try {
        section = jig().config.section(TOOLS_SECTION);
    } catch {
        return new Set();
    }
    const deferred = (section as { deferred?: unknown } | undefined)?.deferred;
    if (!Array.isArray(deferred)) return new Set();
    return new Set(deferred.filter((name): name is string => typeof name === "string" && !NOT_DEFERRABLE.has(name)));
}

/** Whether Pi has a `tool_search` that reaches other tools, so a deferred tool can be found. */
export function hasToolSearch(pi: ExtensionAPI): boolean {
    try {
        return pi.getAllTools().some((tool) => tool.name === TOOL_SEARCH && tool.reachesTools !== undefined);
    } catch {
        return false;
    }
}

/**
 * The tools the transcript of this branch declares active now: its system messages' `toolsAdded` and `toolsRemoved`,
 * replayed in order, as Pi restores the loadout of a resumed session.
 */
export function transcriptTools(ctx: ExtensionContext | undefined): Set<string> {
    const tools = new Set<string>();
    let branch: readonly unknown[];
    try {
        branch = ctx?.sessionManager.getBranch() ?? [];
    } catch {
        return tools;
    }
    const names = (list: unknown): string[] =>
        Array.isArray(list)
            ? list.flatMap((tool) =>
                  typeof (tool as { name?: unknown })?.name === "string" ? [(tool as { name: string }).name] : [],
              )
            : [];
    for (const entry of branch) {
        const message = (entry as { type?: unknown; message?: Record<string, unknown> })?.message;
        if ((entry as { type?: unknown })?.type !== "message" || message?.role !== "system") continue;
        for (const name of names(message.toolsRemoved)) tools.delete(name);
        for (const name of names(message.toolsAdded)) tools.add(name);
    }
    return tools;
}

/** Registers the tool deferred, and takes it out of the active set unless the transcript shows it loaded. */
function defer(pi: ExtensionAPI, slot: Slot, ctx: ExtensionContext | undefined, names: readonly string[]): void {
    if (names.length === 0) return;
    const loaded = transcriptTools(ctx);
    for (const name of names) {
        const tool = slot.tools.get(name);
        if (tool !== undefined) pi.registerTool({ ...tool, exposure: "deferred" });
    }
    const drop = new Set(names.filter((name) => !loaded.has(name)));
    if (drop.size === 0) return;
    const active = pi.getActiveTools();
    if (active.some((name) => drop.has(name))) pi.setActiveTools(active.filter((name) => !drop.has(name)));
}

/** The tools of this plugin that are to be deferred now. */
function toDefer(pi: ExtensionAPI, slot: Slot): string[] {
    const deferred = deferredToolNames();
    if (deferred.size === 0 || !hasToolSearch(pi)) return [];
    return [...slot.tools.keys()].filter((name) => deferred.has(name));
}

/**
 * Registers a Jig tool with Pi: a drop-in for `pi.registerTool(tool)`. The tool is registered as given; when the session
 * starts, a tool named in `jig.json`'s `tools.deferred` is registered again with `exposure: "deferred"` (see the top of
 * this file). Registering again during a session, as a plugin may to change a description, keeps the exposure.
 */
export function registerJigTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown>(
    pi: ExtensionAPI,
    tool: ToolDefinition<TParams, TDetails, TState>,
): void {
    let slot = slots.get(pi);
    if (slot === undefined) {
        const created: Slot = { tools: new Map(), started: false };
        slot = created;
        slots.set(pi, created);
        // A stand-in for Pi with no events (a test that only collects tools) gets the plain registration.
        if (typeof pi.on !== "function") {
            pi.registerTool(tool);
            return;
        }
        pi.on("session_start", (_event, ctx) => {
            created.started = true;
            try {
                defer(pi, created, ctx, toDefer(pi, created));
            } catch {
                // A tool left direct is a larger context, not a broken session.
            }
        });
    }
    slot.tools.set(tool.name, tool as unknown as ToolDefinition);
    if (slot.started && !NOT_DEFERRABLE.has(tool.name) && toDefer(pi, slot).includes(tool.name)) {
        // Registered again mid-session: it stays deferred, and stays active if `tool_search` loaded it.
        pi.registerTool({ ...tool, exposure: "deferred" });
        return;
    }
    pi.registerTool(tool);
}

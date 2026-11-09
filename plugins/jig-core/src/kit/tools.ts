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
import { Text, TruncatedText } from "@earendil-works/pi-tui";
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

/** A tool's own one-line summary for the timeline, from the arguments only. It never sees a body or a query. */
export interface JigToolOptions {
    summary?: (args: Readonly<Record<string, unknown>>) => string | undefined;
}

type JigToolDefinition = ToolDefinition & {
    summary?: (args: Readonly<Record<string, unknown>>) => string | undefined;
};

/** Values that name a call: a branch, a ticket, a service, an environment. Never a body, a query or a description. */
const CALL_KEYS = [
    "ticket",
    "key",
    "issue",
    "number",
    "request",
    "collection",
    "database",
    "cluster",
    "environment",
    "service",
    "status",
    "ref",
    "rev",
    "path",
    "paths",
    "repo",
    "remote",
    "folder",
    "host",
    "since",
    "window",
    "version",
] as const;

const MAX_ARG = 80;

function words(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value !== "string") return undefined;
    const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    if (text === "" || text.length > MAX_ARG) return undefined;
    return text;
}

/** The few arguments that identify a call, with an arrow where the call has a from and a to. */
function callArguments(args: Readonly<Record<string, unknown>>): string[] {
    const action = words(args.action);
    const arrowAction = action !== undefined && ["create", "merge", "rebase", "sync", "view"].includes(action);
    const head = words(args.head) ?? words(args.branch);
    const base = words(args.base);
    if (arrowAction && head !== undefined && base !== undefined) return [`${head} -> ${base}`];
    const parts: string[] = [];
    for (const key of CALL_KEYS) {
        const value = words(args[key]);
        if (value === undefined || parts.includes(value)) continue;
        parts.push(value);
        if (parts.length === 3) break;
    }
    return parts;
}

/** The one-line call: `jira get  PROJ-123`, or `pr create  feature/X -> develop`. */
function callLine(
    tool: string,
    args: Readonly<Record<string, unknown>>,
    summary?: (args: Readonly<Record<string, unknown>>) => string | undefined,
): string {
    const own = summary?.(args)
        ?.replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim();
    if (own !== undefined && own !== "") return own;
    const action = words(args.action) ?? words(args.operation);
    const parts = callArguments(args);
    const head = action === undefined ? tool : `${tool} ${action}`;
    return parts.length === 0 ? head : `${head}  ${parts.join("  ")}`;
}

/** The text of a result, without changing it: the model already has this, this is only its display. */
function resultText(result: { content?: readonly { type?: string; text?: string }[] }): string {
    return (result.content ?? [])
        .flatMap((item) => (item.type === "text" && typeof item.text === "string" ? [item.text] : []))
        .join("\n");
}

/** The one-line result; the full text is shown when Pi expands the row. */
function resultLine(
    result: { content?: readonly { type?: string; text?: string }[]; isError?: boolean },
    expanded: boolean,
    isError: boolean,
): string {
    const text = resultText(result);
    if (expanded) return text;
    const first =
        text
            .split("\n")
            .find((line) => line.trim() !== "")
            ?.trim() ?? "(no output)";
    return `${isError || result.isError === true ? "✗" : "✓"} ${first}`;
}

function withDefaultRenderers(tool: JigToolDefinition, options: JigToolOptions): ToolDefinition {
    const summary = options.summary ?? tool.summary;
    const renderCall = tool.renderCall;
    const renderResult = tool.renderResult;
    return {
        ...tool,
        renderCall:
            renderCall ??
            ((
                args: Readonly<Record<string, unknown>>,
                theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
            ) => {
                const line = callLine(tool.name, args, summary);
                return new TruncatedText(
                    theme.fg("toolTitle", theme.bold(tool.name)) + theme.fg("muted", line.slice(tool.name.length)),
                    0,
                    0,
                );
            }),
        renderResult:
            renderResult ??
            ((
                result: { content?: readonly { type?: string; text?: string }[]; isError?: boolean },
                opts: { expanded?: boolean },
                theme: { fg: (color: string, text: string) => string },
                context: { isError?: boolean; args?: Readonly<Record<string, unknown>> },
            ) =>
                opts.expanded === true
                    ? new Text(theme.fg("toolOutput", resultLine(result, true, context.isError === true)), 0, 0)
                    : new TruncatedText(
                          theme.fg(
                              result.isError === true || context.isError === true ? "error" : "success",
                              resultLine(result, false, context.isError === true),
                          ),
                          0,
                          0,
                      )),
    } as ToolDefinition;
}

/**
 * Registers a Jig tool with Pi: a drop-in for `pi.registerTool(tool)`. The tool is registered as given; when the session
 * starts, a tool named in `jig.json`'s `tools.deferred` is registered again with `exposure: "deferred"` (see the top of
 * this file). Registering again during a session, as a plugin may to change a description, keeps the exposure.
 */
export function registerJigTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = unknown>(
    pi: ExtensionAPI,
    tool: ToolDefinition<TParams, TDetails, TState>,
    options: JigToolOptions = {},
): void {
    const plain = withDefaultRenderers(tool as JigToolDefinition, options);
    const original = plain.execute;
    const definition: JigToolDefinition = {
        ...plain,
        async execute(toolCallId, ...rest: unknown[]) {
            try {
                return await (original as unknown as (...args: unknown[]) => unknown)(toolCallId, ...rest);
            } catch (error) {
                if (error instanceof Error && error.name === "RefusedError") jig().markRefused?.(toolCallId);
                throw error;
            }
        },
    } as JigToolDefinition;
    let slot = slots.get(pi);
    if (slot === undefined) {
        const created: Slot = { tools: new Map(), started: false };
        slot = created;
        slots.set(pi, created);
        // A stand-in for Pi with no events (a test that only collects tools) gets the plain registration.
        if (typeof pi.on !== "function") {
            pi.registerTool(definition);
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
    slot.tools.set(tool.name, definition);
    if (slot.started && !NOT_DEFERRABLE.has(tool.name) && toDefer(pi, slot).includes(tool.name)) {
        // Registered again mid-session: it stays deferred, and stays active if `tool_search` loaded it.
        pi.registerTool({ ...definition, exposure: "deferred" });
        return;
    }
    pi.registerTool(definition);
}

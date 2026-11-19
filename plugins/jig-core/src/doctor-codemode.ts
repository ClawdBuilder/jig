// The doctor's codemode line: whether Pi's `codemode` tool is on, and when Pi turned it on by itself. Codemode is Pi's tool and
// Jig adds no switch for it, so this only reports. Inside a session Pi's active tools answer. The `jig` command has no
// session, so the files Pi reads decide: a `defaultTools` list that adds it, or an MCP server, which makes Pi activate it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { projectTrust } from "./cli/trust.ts";
import type { DoctorContext, DoctorLine } from "./doctor.ts";

const TOOL = "codemode";

/** A JSON file as an object. A missing, broken or non-object file reads as nothing. */
function readObject(file: string): Record<string, unknown> | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether one `defaultTools` list, laid over what was selected before it, leaves codemode in. Pi's rule: plain names form the
 * selection (an empty list too), then `+name` and `-name` apply in order; a list of only `+` and `-` entries changes what came before.
 */
export function layerCodemode(before: boolean, list: unknown): boolean {
    if (!Array.isArray(list)) return before;
    const names = list.filter((item): item is string => typeof item === "string");
    const signedOnly = names.length > 0 && names.every((name) => name.startsWith("+") || name.startsWith("-"));
    let on = signedOnly ? before : names.includes(TOOL);
    for (const name of names) {
        if (name === `+${TOOL}`) on = true;
        else if (name === `-${TOOL}`) on = false;
    }
    return on;
}

/** Whether Pi's settings select codemode: the agent folder's list, then the project's when Pi would trust the folder. */
function addedByDefaultTools(agentDir: string, workingDir: string): boolean {
    let on = layerCodemode(false, readObject(path.join(agentDir, "settings.json"))?.defaultTools);
    if (workingDir !== "" && projectTrust(agentDir, workingDir).trusted) {
        on = layerCodemode(on, readObject(path.join(workingDir, ".pi", "settings.json"))?.defaultTools);
    }
    return on;
}

/** Whether `mcp.json` makes Pi activate codemode by itself: a server that is not turned off, and `autoEnableCodemode` not false. */
function mcpTurnsItOn(agentDir: string): boolean {
    const file = readObject(path.join(agentDir, "mcp.json"));
    const servers = file?.mcpServers;
    if (file === undefined || file.autoEnableCodemode === false) return false;
    if (typeof servers !== "object" || servers === null || Array.isArray(servers)) return false;
    return Object.values(servers).some(
        (server) =>
            typeof server === "object" && server !== null && (server as { enabled?: unknown }).enabled !== false,
    );
}

/** In a session: whether Pi's active tools include codemode. Undefined where Pi has no tool list to ask, as in `jig`. */
export function codemodeInSession(pi: { getActiveTools?: () => unknown }): boolean | undefined {
    try {
        const active = pi.getActiveTools?.();
        return Array.isArray(active) ? active.includes(TOOL) : undefined;
    } catch {
        return undefined;
    }
}

/** The line "Codemode — on" or "off". It is information, never a problem: `ok` either way. */
export function codemodeChecks(
    context: Pick<DoctorContext, "agentDir" | "workingDir" | "codemodeActive">,
): DoctorLine[] {
    const { agentDir, workingDir, codemodeActive } = context;
    if (agentDir === "" && codemodeActive === undefined) return [];
    const added = agentDir !== "" && addedByDefaultTools(agentDir, workingDir);
    const mcp = agentDir !== "" && mcpTurnsItOn(agentDir);
    const on = codemodeActive ?? (added || mcp);
    const reason = on && !added && mcp ? " (turned on by Pi: an MCP server is configured)" : "";
    return [
        {
            id: "config.codemode",
            group: "config",
            level: "ok",
            title: "Codemode",
            detail: `${on ? "on" : "off"}${reason}`,
        },
    ];
}

// The doctor's codemode line: whether Pi's `codemode` tool is on, and when an MCP server is why. Codemode is Pi's tool and Jig
// adds no switch for it, so this only reports. Pi alone decides at session start, from its settings, its flags and its MCP
// files, so the answer is Pi's own: the session's active tools. Outside a session (the `jig` command) there is no answer to
// give, and the line says so; the files are read only for the reason an MCP server gave, never to decide on or off.
import { readFileSync } from "node:fs";
import path from "node:path";
import { projectTrust } from "./cli/trust.ts";
import type { DoctorContext, DoctorLine } from "./doctor.ts";

const TOOL = "codemode";

type Json = Record<string, unknown>;

/** The only keys a project entry without a command or URL may change on the folder's server of that name. */
const OVERRIDES = ["enabled", "exposure", "toolExposure"];

/** A JSON file as an object. A missing, broken or non-object file reads as nothing. */
function readObject(file: string): Json | undefined {
    try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : undefined;
    } catch {
        return undefined;
    }
}

function isObject(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a `defaultTools` list in this settings file names codemode: plain membership, no layering. */
function listsCodemode(settings: string): boolean {
    const list = readObject(settings)?.defaultTools;
    return Array.isArray(list) && list.some((item) => item === TOOL || item === `+${TOOL}`);
}

/** A server entry Pi would keep: a command or a URL. */
function isServer(entry: unknown): entry is Json {
    return isObject(entry) && (typeof entry.command === "string" || typeof entry.url === "string");
}

/** Whether an enabled server has `codemode` exposure: the default, or named for the server or for one of its tools. */
function usesCodemode(server: Json): boolean {
    if (server.enabled === false) return false;
    const tools = isObject(server.toolExposure) ? Object.values(server.toolExposure) : [];
    return server.exposure === undefined || server.exposure === TOOL || tools.includes(TOOL);
}

/**
 * Whether the MCP files make Pi activate codemode by itself: `autoEnableCodemode` is not false (the project's value over the
 * folder's, the project read only when Pi would trust it), and a server is enabled with `codemode` exposure. A project entry
 * replaces a folder entry of the same name; one with no command or URL only overrides `enabled`, `exposure` and `toolExposure`.
 */
function mcpTurnsItOn(agentDir: string, project: string | undefined): boolean {
    const files = [
        readObject(path.join(agentDir, "mcp.json")),
        project === undefined ? undefined : readObject(project),
    ];
    const servers = new Map<string, Json>();
    let auto: boolean | undefined;
    for (const file of files) {
        if (typeof file?.autoEnableCodemode === "boolean") auto = file.autoEnableCodemode;
        const entries = isObject(file?.mcpServers) ? Object.entries(file.mcpServers) : [];
        for (const [name, entry] of entries) {
            const base = servers.get(name);
            if (isServer(entry)) servers.set(name, entry);
            else if (base !== undefined && isObject(entry)) {
                const kept = OVERRIDES.filter((key) => key in entry).map((key) => [key, entry[key]]);
                servers.set(name, { ...base, ...Object.fromEntries(kept) });
            }
        }
    }
    return auto !== false && [...servers.values()].some(usesCodemode);
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

const LINE = { id: "config.codemode", group: "config", title: "Codemode" } as const;

/**
 * The line "Codemode — on" or "off", from the session. `on` says "(turned on by Pi: an MCP server is configured)" when no
 * `defaultTools` list names codemode and the MCP files would turn it on; a flag such as `--tools` is not seen, so that
 * reason is only what the files show. Without a session the line is a skip: nothing but Pi can answer.
 */
export function codemodeChecks(
    context: Pick<DoctorContext, "agentDir" | "workingDir" | "codemodeActive">,
): DoctorLine[] {
    const { agentDir, workingDir, codemodeActive } = context;
    if (codemodeActive === undefined) {
        const detail = "Pi decides this when a session starts; /jig doctor inside Pi shows it.";
        return [{ ...LINE, level: "skip", detail }];
    }
    let reason = "";
    if (codemodeActive && agentDir !== "") {
        const trusted = workingDir !== "" && projectTrust(agentDir, workingDir).trusted;
        const projectDir = trusted ? path.join(workingDir, ".pi") : undefined;
        const listed =
            listsCodemode(path.join(agentDir, "settings.json")) ||
            (projectDir !== undefined && listsCodemode(path.join(projectDir, "settings.json")));
        if (!listed && mcpTurnsItOn(agentDir, projectDir === undefined ? undefined : path.join(projectDir, "mcp.json")))
            reason = " (turned on by Pi: an MCP server is configured)";
    }
    return [{ ...LINE, level: "ok", detail: `${codemodeActive ? "on" : "off"}${reason}` }];
}

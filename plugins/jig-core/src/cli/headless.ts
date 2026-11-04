// The plugins Pi would load, loaded without Pi: a small host for their factories, jig-core's state, and the packages named
// in the agent folder's settings.json. It registers sections and company defaults and never starts a tool, a session, a
// watch, a tunnel or a sign-in: nothing fires a hook or calls a tool here.
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildApi } from "../api.ts";
import { publishJig } from "../client.ts";
import { errorMessage } from "../errors.ts";
import { createState, loadPersonalConfig } from "../state.ts";
import type { JigState } from "../state.ts";

/** One package that could not be loaded, with the plain reason: the doctor shows it as a FAIL line. */
export interface LoadFailure {
    package: string;
    file?: string;
    reason: string;
}

/** The agent folder, found as Pi finds it. */
export function agentDirFor(env: NodeJS.ProcessEnv = process.env): string {
    const named = env.PI_CODING_AGENT_DIR;
    return named !== undefined && named.trim() !== ""
        ? path.resolve(named.trim())
        : path.join(homedir(), ".pi", "agent");
}

/** A Pi that only records: nothing here runs a hook, opens a screen or starts a tool. */
function headlessPi(state: { handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>> }) {
    const known: Record<string, unknown> = {
        on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
            state.handlers.set(event, [...(state.handlers.get(event) ?? []), handler]);
            return () => {
                state.handlers.set(
                    event,
                    (state.handlers.get(event) ?? []).filter((entry) => entry !== handler),
                );
            };
        },
        registerTool: () => {},
        registerCommand: () => {},
        registerShortcut: () => {},
        sendMessage: () => {},
        events: {
            on: () => () => {},
            emit: () => {},
        },
        ui: undefined,
        getAgentDir: () => "",
    };
    // Pi's API grows: a name this host does not know is a function that does nothing, so a plugin that registers an extra
    // renderer still loads. Data members a plugin may read are named above.
    return new Proxy(known, {
        get(target, property, receiver) {
            if (property in target) return Reflect.get(target, property, receiver);
            if (typeof property === "symbol") return undefined;
            return () => {};
        },
    }) as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
}

/** A package's extension files, from its `pi.extensions`, or its main file when the manifest says nothing. */
function extensionsOf(folder: string): string[] {
    try {
        const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as {
            pi?: { extensions?: unknown };
            main?: string;
        };
        const listed = manifest.pi?.extensions;
        if (Array.isArray(listed) && listed.length > 0 && listed.every((item) => typeof item === "string")) {
            return listed.map((item) => path.resolve(folder, item));
        }
        if (typeof manifest.main === "string" && existsSync(path.resolve(folder, manifest.main))) {
            return [path.resolve(folder, manifest.main)];
        }
    } catch {
        // Not a package, or no manifest: the caller reports it.
    }
    return [];
}

/** The CLI's own package.json: its name, version and repository, for what a person should install. */
export function ownPackage(): { name?: string; version?: string; repository?: string } {
    try {
        const manifest = JSON.parse(
            readFileSync(path.resolve(import.meta.dirname, "../../../../package.json"), "utf8"),
        ) as { name?: string; version?: string; repository?: unknown };
        const repository =
            typeof manifest.repository === "string"
                ? manifest.repository
                : typeof manifest.repository === "object" && manifest.repository !== null
                  ? (manifest.repository as { url?: string }).url
                  : undefined;
        return {
            ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
            ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
            ...(repository === undefined ? {} : { repository }),
        };
    } catch {
        return {};
    }
}

/** Where a settings entry lives: a local folder, or the npm package Pi installed under the agent folder. */
function folderOf(source: string, agentDir: string): string | undefined {
    const trimmed = source.trim();
    if (trimmed.startsWith("npm:")) {
        const spec = trimmed.slice(4);
        const at = spec.lastIndexOf("@");
        const name = at > 0 ? spec.slice(0, at) : spec;
        return path.join(agentDir, "npm", "node_modules", name);
    }
    if (trimmed.startsWith("git:") || trimmed.includes("://")) return undefined;
    const expanded = trimmed.startsWith("~/") ? path.join(homedir(), trimmed.slice(2)) : trimmed;
    // Pi writes a local package as a path relative to the agent folder, so that is where a relative one is read from.
    return path.isAbsolute(expanded) ? expanded : path.resolve(agentDir, expanded);
}

/** The packages named in the agent folder's settings.json, resolved, and whether Jig itself is one of them. */
export function installedPackages(
    agentDir: string,
    env: NodeJS.ProcessEnv,
): { packages: Array<{ name: string; folder: string }>; jigInPi: boolean; jigInPiVersion?: string } {
    const out: Array<{ name: string; folder: string }> = [];
    let settings: Record<string, unknown> = {};
    try {
        const raw = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8")) as unknown;
        if (typeof raw === "object" && raw !== null) settings = raw as Record<string, unknown>;
    } catch {
        // No settings, or not JSON: nothing installed through Pi. The package this CLI runs from is still loaded.
    }
    const listed = Array.isArray(settings.packages) ? settings.packages : [];
    for (const entry of listed) {
        const source =
            typeof entry === "string"
                ? entry
                : typeof entry === "object" && entry !== null
                  ? (entry as { source?: unknown }).source
                  : undefined;
        if (typeof source !== "string" || source.trim() === "") continue;
        const folder = folderOf(source, agentDir);
        if (folder === undefined || !existsSync(folder)) continue;
        out.push({ name: source, folder });
    }
    const own = ownPackage();
    let jigInPi = false;
    let jigInPiVersion: string | undefined;
    for (const entry of out) {
        try {
            const manifest = JSON.parse(readFileSync(path.join(entry.folder, "package.json"), "utf8")) as {
                name?: unknown;
                version?: unknown;
            };
            if (own.name !== undefined && manifest.name === own.name) {
                jigInPi = true;
                if (typeof manifest.version === "string") jigInPiVersion = manifest.version;
            }
        } catch {
            // Not a package; loading it reports that.
        }
    }
    // The CLI lives in the jig package: load it even when settings do not list it, so doctor can say that plainly.
    const ownFolder = path.resolve(import.meta.dirname, "../../../..");
    if (existsSync(path.join(ownFolder, "package.json"))) {
        const at = out.findIndex((entry) => path.resolve(entry.folder) === ownFolder);
        if (at > 0) out.splice(at, 1);
        if (at !== 0) out.unshift({ name: own.name ?? "jig", folder: ownFolder });
    }
    return { packages: out, jigInPi, ...(jigInPiVersion === undefined ? {} : { jigInPiVersion }) };
}

export interface Headless {
    state: JigState;
    failures: LoadFailure[];
    /** The packages whose extensions were loaded, by the settings source. */
    loaded: string[];
    /** Whether Pi's settings name the Jig package: doctor fails when they do not, and setup stops. */
    jigInPi: boolean;
    /** The version of the Jig copy Pi loads, when it is installed. */
    jigInPiVersion?: string;
    /** How long each package's extensions took to load, slowest first: what the blank screen was. */
    timings: Array<{ name: string; ms: number }>;
}

/** Loads what Pi would load, then reads the person's jig.json. Never starts a session. */
export async function loadHeadless(
    options: { agentDir?: string; workingDir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<Headless> {
    const env = options.env ?? process.env;
    const agentDir = options.agentDir ?? agentDirFor(env);
    const workingDir = options.workingDir ?? process.cwd();
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
    const pi = headlessPi({ handlers });
    // The state and API are made here rather than by jig-core's extension: its factory pulls in the commands, watch,
    // previews and review screen, which setup and doctor never use and which cost most of the seconds before the first line.
    const state = createState(pi, { env });
    state.configPath = () => path.join(agentDir, "jig.json");
    state.agentDir = () => agentDir;
    state.workingDir = workingDir;
    state.sessionId = "jig-cli";
    publishJig(buildApi(state));

    const failures: LoadFailure[] = [];
    const loaded: string[] = [];
    const timings: Array<{ name: string; ms: number }> = [];
    const installed = installedPackages(agentDir, env);
    const jigInPi = installed.jigInPi;
    const jigInPiVersion = installed.jigInPiVersion;
    for (const entry of installed.packages) {
        const startedAt = performance.now();
        const files = extensionsOf(entry.folder);
        if (files.length === 0) {
            failures.push({ package: entry.name, reason: "no Pi extensions: its package.json names none" });
            continue;
        }
        for (const file of files) {
            const fileStarted = performance.now();
            if (!existsSync(file) || !statSync(file).isFile()) {
                failures.push({ package: entry.name, file, reason: "the file a package.json names is not there" });
                continue;
            }
            // jig-core's own extension is the one module this command does not need: its state is made above.
            if (/\/plugins\/jig-core\/index\.ts$/.test(file)) continue;
            try {
                const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
                const factory = module.default;
                if (typeof factory !== "function") {
                    failures.push({ package: entry.name, file, reason: "the extension exports no default function" });
                    continue;
                }
                (factory as (pi: unknown) => void)(pi);
                loaded.push(entry.name);
            } catch (error) {
                failures.push({ package: entry.name, file, reason: errorMessage(error).slice(0, 300) });
            }
            timings.push({ name: path.relative(entry.folder, file), ms: performance.now() - fileStarted });
        }
        void startedAt;
    }
    timings.sort((left, right) => right.ms - left.ms);
    // The person's file last: the sections and defaults above are what it is checked against.
    loadPersonalConfig(state);
    return { state, failures, loaded, jigInPi, ...(jigInPiVersion === undefined ? {} : { jigInPiVersion }), timings };
}

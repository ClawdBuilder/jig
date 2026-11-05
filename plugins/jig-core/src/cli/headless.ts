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
import { manifestOf, parseGitSource, parseNpmSource, readPackages } from "./packages.ts";
import type { ListedPackage } from "./packages.ts";
import { projectTrust, untrustedDetail, untrustedSetupLine } from "./trust.ts";
import { enabledFiles } from "./package-filter.ts";
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

/** The extension entries a package's manifest names, relative to its folder; its main file when it names none. */
function manifestExtensions(folder: string): string[] {
    try {
        const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as {
            pi?: { extensions?: unknown };
            main?: string;
        };
        const listed = manifest.pi?.extensions;
        if (Array.isArray(listed) && listed.length > 0 && listed.every((item) => typeof item === "string")) {
            return listed as string[];
        }
        if (typeof manifest.main === "string" && existsSync(path.resolve(folder, manifest.main))) {
            return [manifest.main];
        }
    } catch {
        // Not a package, or no manifest: the caller reports it.
    }
    return [];
}

/** The plugin a Jig extension file belongs to, as in `plugins/jig-jira/index.ts`. */
function pluginOf(file: string): string | undefined {
    return /^plugins\/([^/]+)\/index\.ts$/.exec(file.replace(/^\.\//, ""))?.[1];
}

/** The built-in choosable plugins, their feature name and the section whose settings they validate. */
const FEATURES: Readonly<Record<string, { feature: string; section?: string }>> = {
    "jig-jira": { feature: "jira", section: "jira" },
    "jig-logs": { feature: "logs", section: "logs" },
    "jig-mongo": { feature: "mongo", section: "mongo" },
    "jig-api": { feature: "api", section: "api" },
    "jig-ops": { feature: "ops", section: "ops" },
    "jig-review": { feature: "review" },
    "jig-agents": { feature: "agents", section: "agents" },
    "jig-workflow": { feature: "workflow", section: "workflow" },
    "jig-lens": { feature: "lens", section: "lens" },
};

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

export interface Headless {
    state: JigState;
    failures: LoadFailure[];
    /** The packages whose extensions were loaded, by the settings source. */
    loaded: string[];
    /** Whether Pi's settings name the Jig package: doctor fails when they do not, and setup stops. */
    jigInPi: boolean;
    /** The version of the Jig copy Pi loads, when it is installed. */
    jigInPiVersion?: string;
    /** Set when Pi lists Jig but its folder is not there: not the same as Jig never installed. */
    jigListedButMissing?: { source: string; problem: string };
    /** Packages Pi lists whose files are not there, or whose source cannot be read. */
    packageProblems: Array<{ source: string; problem: string }>;
    /** Project-scope packages that were not loaded because Pi would not load them either, and why. */
    projectSkipped?: {
        sources: string[];
        detail: string;
        fix?: string;
        setupLine: string;
        jigIncluded: boolean;
    };
    /** Jig plugins Pi's settings filter out, and the sections that go with them. */
    filtered?: {
        core?: string;
        sandbox?: string;
        features: Array<{ feature: string; section?: string; source: string }>;
        offSections: string[];
    };
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
    const installed = readPackages(agentDir, workingDir);
    // Project-scope packages are code from a folder the person may not have trusted: import nothing from them until Pi's
    // own saved decisions (or its global default) say Pi would load them too.
    const trust = projectTrust(agentDir, workingDir);
    const projectEntries = installed.listed.filter((entry) => entry.scope === "project");
    const skippedProject = trust.trusted ? [] : projectEntries;
    const loadable = installed.listed.filter((entry) => !skippedProject.includes(entry));
    const own = ownPackage();
    const packageProblems: Array<{ source: string; problem: string }> = installed.listed.flatMap((entry) =>
        entry.problem === undefined ? [] : [{ source: entry.source, problem: entry.problem }],
    );
    for (const settingsProblem of installed.settingsProblems) {
        packageProblems.push({
            source: settingsProblem.file,
            problem: `Pi's settings there could not be read: ${settingsProblem.problem}`,
        });
    }
    const looksLikeJig = (entry: ListedPackage): boolean => {
        if (own.name === undefined) return false;
        const npm = parseNpmSource(entry.source);
        if (npm !== undefined) return npm.name === own.name;
        const git = parseGitSource(entry.source);
        if (git !== undefined) return git.path.split("/").at(-1) === own.name;
        return entry.folder !== undefined && path.basename(entry.folder) === own.name;
    };
    const jigListedButMissing = installed.listed.find((entry) => entry.problem !== undefined && looksLikeJig(entry));
    const jigSkippedUntrusted = skippedProject.some((entry) => looksLikeJig(entry));
    let jigInPi = false;
    let jigInPiVersion: string | undefined;
    const jigPlugins = new Set<string>();
    const enabledPlugins = new Set<string>();
    for (const entry of loadable) {
        if (entry.problem !== undefined || entry.folder === undefined) continue;
        const startedAt = performance.now();
        const rawFiles = manifestExtensions(entry.folder);
        const allFiles = rawFiles.map((item) => path.resolve(entry.folder ?? "", item));
        if (allFiles.length === 0) {
            failures.push({ package: entry.source, reason: "no Pi extensions: its package.json names none" });
            continue;
        }
        const enabled = enabledFiles(allFiles, entry.filter, "extensions", entry.folder);
        const files = allFiles.filter((file) => enabled.has(file));
        const manifest = manifestOf(entry.folder);
        if (own.name !== undefined && manifest?.name === own.name) {
            jigInPi = true;
            if (manifest.version !== undefined) jigInPiVersion = manifest.version;
            for (const item of rawFiles) {
                const plugin = pluginOf(item);
                if (plugin !== undefined) jigPlugins.add(plugin);
            }
            for (const file of files) {
                const plugin = pluginOf(path.relative(entry.folder, file).split(path.sep).join("/"));
                if (plugin !== undefined) enabledPlugins.add(plugin);
            }
        }
        for (const file of files) {
            const fileStarted = performance.now();
            if (!existsSync(file) || !statSync(file).isFile()) {
                failures.push({ package: entry.source, file, reason: "the file a package.json names is not there" });
                continue;
            }
            // jig-core's own extension is the one module this command does not need: its state is made above.
            if (/\/plugins\/jig-core\/index\.ts$/.test(file)) continue;
            try {
                const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
                const factory = module.default;
                if (typeof factory !== "function") {
                    failures.push({ package: entry.source, file, reason: "the extension exports no default function" });
                    continue;
                }
                (factory as (pi: unknown) => void)(pi);
                loaded.push(entry.source);
            } catch (error) {
                failures.push({ package: entry.source, file, reason: errorMessage(error).slice(0, 300) });
            }
            timings.push({ name: path.relative(entry.folder, file), ms: performance.now() - fileStarted });
        }
        void startedAt;
    }
    timings.sort((left, right) => right.ms - left.ms);
    const filteredFeatures: Array<{ feature: string; section?: string; source: string }> = [];
    for (const [plugin, feature] of Object.entries(FEATURES)) {
        if (
            jigPlugins.has(plugin) &&
            !enabledPlugins.has(plugin) &&
            !filteredFeatures.some((one) => one.feature === feature.feature)
        ) {
            filteredFeatures.push({
                feature: feature.feature,
                ...(feature.section === undefined ? {} : { section: feature.section }),
                source: "Pi's settings",
            });
        }
    }
    const offSections = filteredFeatures.flatMap((one) => (one.section === undefined ? [] : [one.section]));
    const filtered =
        filteredFeatures.length === 0 &&
        !(jigPlugins.has("jig-core") && !enabledPlugins.has("jig-core")) &&
        !(jigPlugins.has("jig-sandbox") && !enabledPlugins.has("jig-sandbox"))
            ? undefined
            : {
                  ...(jigPlugins.has("jig-core") && !enabledPlugins.has("jig-core") ? { core: "Pi's settings" } : {}),
                  ...(jigPlugins.has("jig-sandbox") && !enabledPlugins.has("jig-sandbox")
                      ? { sandbox: "Pi's settings" }
                      : {}),
                  features: filteredFeatures,
                  offSections,
              };
    state.offSections = new Set(offSections);
    // The person's file last: the sections and defaults above are what it is checked against.
    loadPersonalConfig(state);
    return {
        state,
        failures,
        loaded,
        jigInPi,
        ...(jigInPiVersion === undefined ? {} : { jigInPiVersion }),
        ...(jigListedButMissing === undefined
            ? {}
            : {
                  jigListedButMissing: {
                      source: jigListedButMissing.source,
                      problem: jigListedButMissing.problem ?? "",
                  },
              }),
        packageProblems,
        ...(filtered === undefined ? {} : { filtered }),
        ...(skippedProject.length === 0
            ? {}
            : {
                  projectSkipped: {
                      sources: skippedProject.map((entry) => entry.source),
                      detail: untrustedDetail(
                          skippedProject.map((entry) => entry.source),
                          trust,
                      ),
                      ...(trust.fix === undefined ? {} : { fix: trust.fix }),
                      setupLine: untrustedSetupLine(
                          skippedProject.map((entry) => entry.source),
                          trust,
                      ),
                      jigIncluded: jigSkippedUntrusted,
                  },
              }),
        timings,
    };
}

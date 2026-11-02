// The code Pi loads on its own at the next start, outside any sandbox, and so must not be changed by the agent: the local packages
// and extensions that Pi's settings name, and the files of the extensions Pi has loaded. They are default protected paths of
// kind `guarded`: Pi's file tools can read them and not write them, and the sandbox locks them for `bash`.
//
// Pi's own rules, read from its package manager (`dist/core/package-manager.js`, Pi 1.5):
//   - the settings are the agent folder's `settings.json` (scope user) and `<working folder>/.pi/settings.json` (scope project);
//   - a `packages` entry is a string or `{ source, ... }`; it is local unless it starts with `npm:`, `git:`, `github:`, `http:`,
//     `https:`, `ssh:` or `builtin:` (`isLocalPath`), and a local one is a path with `~` and `file://` understood, a relative one
//     starting from the folder of the settings file for the user scope (the agent folder) and from `<working folder>/.pi` for
//     the project scope (`getBaseDirForScope`);
//   - `git:` and `npm:` packages are installed under `<agent folder>/git` and `/npm` (user scope), which the agent folder guard
//     covers, and under `<working folder>/.pi/git` and `/npm` (project scope), which the sandbox does not lock;
//   - the plain entries of the `extensions` list are paths the same way; an entry that starts with `!`, `+` or `-`, or has `*` or
//     `?` in it, only filters;
//   - a path may be a folder (a package, or a folder of extensions) or one file (one extension).
// A path is guarded whether or not it exists yet: Pi skips a missing one, and a file made there before the next start would be loaded.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coversHome, guardedEntry, mergeProtected } from "./protected-paths.ts";
import type { ProtectedPath } from "./protected-paths.ts";

/** What Pi tells apart in a package source: these are not local paths. */
const NOT_LOCAL: readonly string[] = ["npm:", "git:", "github:", "http:", "https:", "ssh:", "builtin:"];

/** The most entries read from one list, and the longest source: a settings file is the user's, but a big one is not read whole. */
const MAX_ENTRIES = 200;
const MAX_SOURCE_CHARS = 1000;
const MAX_SETTINGS_BYTES = 1024 * 1024;

export interface LoadedCodeInput {
    /** Pi's agent folder, which holds the user's `settings.json`. Empty when not known: that file is not read. */
    agentDir: string;
    /** Pi's working folder, which holds the project's `.pi/settings.json`. Empty when not known. */
    cwd: string;
    home: string;
    platform?: NodeJS.Platform;
    /** The text of a file, or undefined when it cannot be read. Default: the file system. */
    read?: (file: string) => string | undefined;
    /** The entry files of the extensions Pi has loaded, as far as Pi says (see `loadedExtensionFiles`). */
    extensionFiles?: readonly string[];
}

function flavour(platform: NodeJS.Platform | undefined): typeof path.posix {
    return (platform ?? process.platform) === "win32" ? path.win32 : path.posix;
}

function readFile(file: string): string | undefined {
    try {
        const text = readFileSync(file, "utf8");
        return text.length > MAX_SETTINGS_BYTES ? undefined : text;
    } catch {
        return undefined;
    }
}

/** Whether Pi reads a source as a local path (`isLocalPath`): everything but the known prefixes. */
export function isLocalSource(source: string): boolean {
    const text = source.trim();
    return text !== "" && !NOT_LOCAL.some((prefix) => text.startsWith(prefix));
}

/** A path as Pi resolves it: `~` and `file://` understood, and a relative one starting from `base`. */
export function resolveFrom(text: string, base: string, home: string, platform?: NodeJS.Platform): string | undefined {
    const pathApi = flavour(platform);
    let value = text.trim();
    if (value === "" || value.length > MAX_SOURCE_CHARS) return undefined;
    if (value === "~") value = home;
    else if (value.startsWith("~/") || (pathApi === path.win32 && value.startsWith("~\\"))) {
        value = pathApi.join(home, value.slice(2));
    } else if (/^file:\/\//.test(value)) {
        try {
            value = fileURLToPath(value);
        } catch {
            return undefined;
        }
    }
    return pathApi.isAbsolute(value) ? pathApi.resolve(value) : pathApi.resolve(base, value);
}

/** The local sources of the `packages` list and the plain entries of the `extensions` list of one settings file. */
export function localSources(settingsText: string): { packages: string[]; extensions: string[] } {
    const none = { packages: [], extensions: [] };
    let parsed: unknown;
    try {
        parsed = JSON.parse(settingsText);
    } catch {
        return none;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return none;
    const { packages, extensions } = parsed as { packages?: unknown; extensions?: unknown };
    const found = { packages: [] as string[], extensions: [] as string[] };
    if (Array.isArray(packages)) {
        for (const item of packages.slice(0, MAX_ENTRIES)) {
            const source = typeof item === "string" ? item : (item as { source?: unknown } | null)?.source;
            if (typeof source === "string" && isLocalSource(source)) found.packages.push(source);
        }
    }
    if (Array.isArray(extensions)) {
        for (const item of extensions.slice(0, MAX_ENTRIES)) {
            // An entry that starts with `!`, `+` or `-`, or has a wildcard, only switches files on or off.
            if (typeof item !== "string" || /^[!+-]|[*?]/.test(item)) continue;
            if (isLocalSource(item)) found.extensions.push(item);
        }
    }
    return found;
}

/** The entry files of the extensions Pi has loaded, from the tools and commands they registered: an extension that registered
 *  neither is not in Pi's lists. A built-in or inline extension has no file path, so it is left out. */
export function loadedExtensionFiles(pi: {
    getAllTools?: () => ReadonlyArray<{ sourceInfo?: { path?: unknown } }>;
    getCommands?: () => ReadonlyArray<{ sourceInfo?: { path?: unknown } }>;
}): string[] {
    const files = new Set<string>();
    for (const list of [pi.getAllTools, pi.getCommands]) {
        let infos: ReadonlyArray<{ sourceInfo?: { path?: unknown } }> = [];
        try {
            // Pi refuses these calls while extensions are still loading; the next time the policy is built they work.
            infos = list?.call(pi) ?? [];
        } catch {
            infos = [];
        }
        for (const info of infos) {
            const file = info.sourceInfo?.path;
            if (typeof file === "string" && (path.posix.isAbsolute(file) || path.win32.isAbsolute(file)))
                files.add(file);
        }
    }
    return [...files];
}

/** True when `child` is `parent` or inside it, as plain text: for leaving out what a wider entry already guards. */
function within(child: string, parent: string, pathApi: typeof path.posix): boolean {
    const relative = pathApi.relative(parent, child);
    return relative === "" || (!relative.startsWith("..") && !pathApi.isAbsolute(relative));
}

/**
 * The guarded paths for the code Pi loads: each local package and extension of the user's settings and of the project's, and the
 * files of the extensions Pi loaded that lie outside every folder guarded already. A path that would guard the whole home folder,
 * a folder above it, or the root is ignored, as for the paths that an environment variable names.
 */
export function loadedCodePaths(input: LoadedCodeInput): ProtectedPath[] {
    const { agentDir, cwd, home, platform } = input;
    const pathApi = flavour(platform);
    const read = input.read ?? readFile;
    const out: ProtectedPath[] = [];
    const add = (absolute: string | undefined, note: string): void => {
        if (absolute === undefined || coversHome(absolute, home, platform)) return;
        out.push(guardedEntry(absolute, note, home, platform));
    };

    const scopes: Array<{ file: string; base: string; name: string }> = [];
    if (agentDir !== "")
        scopes.push({ file: pathApi.join(agentDir, "settings.json"), base: agentDir, name: "settings.json" });
    if (cwd !== "") {
        const folder = pathApi.join(cwd, ".pi");
        scopes.push({ file: pathApi.join(folder, "settings.json"), base: folder, name: ".pi/settings.json" });
    }
    for (const scope of scopes) {
        const text = read(scope.file);
        if (text === undefined) continue;
        const sources = localSources(text);
        for (const source of sources.packages) {
            add(resolveFrom(source, scope.base, home, platform), `a package in ${scope.name}`);
        }
        for (const source of sources.extensions) {
            add(resolveFrom(source, scope.base, home, platform), `an extension in ${scope.name}`);
        }
    }

    // The extensions Pi loaded from somewhere else: a single file that nothing above guards. The agent folder is guarded whole.
    const guarded = [...out.map((entry) => entry.path), ...(agentDir === "" ? [] : [agentDir])];
    for (const file of input.extensionFiles ?? []) {
        const absolute = pathApi.resolve(file);
        if (guarded.some((folder) => within(absolute, folder, pathApi))) continue;
        add(absolute, "an extension Pi loaded");
    }
    return mergeProtected([], out, platform);
}

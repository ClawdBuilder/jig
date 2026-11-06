// Where Pi puts an installed package, as stock Pi 1.5 does it, so the `jig` command finds the same packages Pi loads:
// a local folder, an npm package under <scope>/npm/node_modules, or a git clone under <scope>/git/<host>/<path>. The
// @ref of a git source is not in the folder name, and .git is stripped. Project scope lives under <cwd>/.pi and is listed
// in <cwd>/.pi/settings.json; user scope lives in the agent folder and is listed in its settings.json.
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { filterOf } from "./package-filter.ts";
import type { PackageFilter } from "./package-filter.ts";
import { homedir } from "node:os";
import path from "node:path";

export type PackageScope = "user" | "project";

/** A settings entry, and where Pi keeps it. `problem` is set when Pi lists it but its files cannot be found or read. */
export interface ListedPackage {
    source: string;
    scope: PackageScope;
    folder?: string;
    problem?: string;
    /** The object entry's filter; a string entry has none, and Pi loads everything it names. */
    filter?: PackageFilter;
}

export interface ReadPackages {
    listed: ListedPackage[];
    /** Pi's settings files that could not be read, with the file and the reason. */
    settingsProblems: Array<{ file: string; problem: string }>;
}

const GIT_PREFIX = "git:";
const PROTOCOL = /^(https?|ssh|git):\/\//i;
const SCP_LIKE = /^git@([^:]+):(.+)$/;
const NPM_SPEC = /^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/;

/** Splits an optional `@ref` off a git path or URL, as Pi's splitRef does: the first @ after the repository path. */
function splitRef(source: string): { repo: string; ref?: string } {
    const scp = SCP_LIKE.exec(source);
    if (scp !== null) {
        const rest = scp[2] ?? "";
        const at = rest.indexOf("@");
        if (at <= 0 || at === rest.length - 1) return { repo: source };
        return { repo: `git@${scp[1] ?? ""}:${rest.slice(0, at)}`, ref: rest.slice(at + 1) };
    }
    if (source.includes("://")) {
        try {
            const url = new URL(source);
            const pathname = url.pathname.replace(/^\/+/, "");
            const at = pathname.indexOf("@");
            if (at <= 0 || at === pathname.length - 1) return { repo: source.replace(/\/+$/, "") };
            url.pathname = `/${pathname.slice(0, at)}`;
            return { repo: url.toString().replace(/\/+$/, ""), ref: pathname.slice(at + 1) };
        } catch {
            return { repo: source };
        }
    }
    const slash = source.indexOf("/");
    if (slash < 0) return { repo: source };
    const host = source.slice(0, slash);
    const rest = source.slice(slash + 1);
    const at = rest.indexOf("@");
    if (at <= 0 || at === rest.length - 1) return { repo: source };
    return { repo: `${host}/${rest.slice(0, at)}`, ref: rest.slice(at + 1) };
}

/** A host and path from a git source, Pi's forms: with `git:`, a host shorthand too; without it, a protocol URL only. */
export function parseGitSource(source: string): { host: string; path: string; ref?: string } | undefined {
    const trimmed = source.trim();
    // `git://` is a protocol of its own, not the `git:` prefix followed by `//`.
    const prefixed = trimmed.startsWith(GIT_PREFIX) && !trimmed.startsWith("git://");
    const rest = (prefixed ? trimmed.slice(GIT_PREFIX.length) : trimmed).trim();
    if (!prefixed && !PROTOCOL.test(rest)) return undefined;
    const { repo, ref } = splitRef(rest);
    const scp = SCP_LIKE.exec(repo);
    let host: string;
    let repoPath: string;
    if (scp !== null) {
        host = scp[1] ?? "";
        repoPath = scp[2] ?? "";
    } else if (PROTOCOL.test(repo)) {
        try {
            const url = new URL(repo);
            host = url.hostname;
            repoPath = url.pathname.replace(/^\/+/, "");
        } catch {
            return undefined;
        }
    } else {
        const slash = repo.indexOf("/");
        if (slash <= 0) return undefined;
        host = repo.slice(0, slash);
        repoPath = repo.slice(slash + 1);
        if (!host.includes(".") && host !== "localhost") return undefined;
    }
    const cleanHost = host.toLowerCase();
    const cleanPath = repoPath
        .replace(/\/+$/, "")
        .replace(/\.git$/, "")
        .replace(/^\/+/, "");
    if (cleanHost === "" || cleanPath.split("/").length < 2) return undefined;
    if (/[\\\0]/.test(cleanHost) || cleanHost.split("/").includes("..")) return undefined;
    if (/[\\\0]/.test(cleanPath) || cleanPath.split("/").includes("..")) return undefined;
    return { host: cleanHost, path: cleanPath, ...(ref === undefined ? {} : { ref }) };
}

/** The npm package name of `npm:<name>[@version]`, as Pi's parseNpmSpec reads it. */
export function parseNpmSource(source: string): { name: string } | undefined {
    if (!source.trim().startsWith("npm:")) return undefined;
    const spec = source.trim().slice(4).trim();
    if (spec === "") return undefined;
    const match = NPM_SPEC.exec(spec);
    const name = match?.[1] ?? spec;
    return name === "" ? undefined : { name };
}

/** `<root>/git/<host>/<path>`, the folder Pi clones a git source into. */
export function gitFolder(root: string, host: string, repoPath: string): string {
    return path.join(root, "git", host, ...repoPath.split("/"));
}

/** Where one settings entry lives, relative to the folder its scope keeps packages in. */
export function packageFolder(source: string, base: string): { folder?: string; problem?: string } {
    const trimmed = source.trim();
    if (trimmed === "") return { problem: "the entry is empty" };
    if (trimmed.startsWith("npm:")) {
        const npm = parseNpmSource(trimmed);
        if (npm === undefined) return { problem: "the npm name cannot be read" };
        return { folder: path.join(base, "npm", "node_modules", npm.name) };
    }
    if (trimmed.startsWith(GIT_PREFIX) || PROTOCOL.test(trimmed)) {
        const git = parseGitSource(trimmed);
        if (git === undefined) return { problem: "the git address cannot be read" };
        return { folder: gitFolder(base, git.host, git.path) };
    }
    const expanded = trimmed.startsWith("~/") ? path.join(homedir(), trimmed.slice(2)) : trimmed;
    return { folder: path.isAbsolute(expanded) ? expanded : path.resolve(base, expanded) };
}

function readSettings(file: string, problems: ReadPackages["settingsProblems"]): unknown[] {
    if (!existsSync(file)) return [];
    try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
        const packages = typeof raw === "object" && raw !== null ? (raw as { packages?: unknown }).packages : undefined;
        return Array.isArray(packages) ? packages : [];
    } catch (error) {
        problems.push({ file, problem: error instanceof Error ? error.message : String(error) });
        return [];
    }
}

/** Every package Pi lists, in both scopes, with its folder or the reason it cannot be found. */
export function readPackages(agentDir: string, workingDir: string): ReadPackages {
    const settingsProblems: ReadPackages["settingsProblems"] = [];
    const listed: ListedPackage[] = [];
    const scopes: Array<{ scope: PackageScope; base: string; settings: string }> = [
        { scope: "user", base: agentDir, settings: path.join(agentDir, "settings.json") },
        {
            scope: "project",
            base: path.join(workingDir, ".pi"),
            settings: path.join(workingDir, ".pi", "settings.json"),
        },
    ];
    for (const { scope, base, settings } of scopes) {
        for (const entry of readSettings(settings, settingsProblems)) {
            const source =
                typeof entry === "string"
                    ? entry
                    : typeof entry === "object" && entry !== null
                      ? (entry as { source?: unknown }).source
                      : undefined;
            if (typeof source !== "string" || source.trim() === "") continue;
            const filter = filterOf(entry);
            const found = packageFolder(source, base);
            const folder = found.folder;
            if (folder === undefined) {
                listed.push({
                    source: source.trim(),
                    scope,
                    ...(filter === undefined ? {} : { filter }),
                    problem: found.problem ?? "its folder cannot be worked out",
                });
                continue;
            }
            // Pi falls back to the global npm root for a user-scope npm package it cannot find under the agent folder.
            const npm = parseNpmSource(source);
            const legacy =
                npm === undefined || scope !== "user"
                    ? undefined
                    : path.join(path.dirname(process.execPath), "..", "lib", "node_modules", npm.name);
            if (!existsSync(folder) && legacy !== undefined && existsSync(legacy)) {
                listed.push({
                    source: source.trim(),
                    scope,
                    folder: legacy,
                    ...(filter === undefined ? {} : { filter }),
                });
                continue;
            }
            if (!existsSync(folder)) {
                listed.push({
                    source: source.trim(),
                    scope,
                    folder,
                    ...(filter === undefined ? {} : { filter }),
                    problem: `Pi lists it, but its files are not there: ${folder}`,
                });
                continue;
            }
            listed.push({ source: source.trim(), scope, folder, ...(filter === undefined ? {} : { filter }) });
        }
    }
    return { listed, settingsProblems };
}

/** Pi's path comparison key: resolved, and case-folded on Windows. */
function comparisonKey(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** Pi's package identity: npm by name, git by host/path (the ref is not part), local by absolute path. */
export function packageIdentity(entry: ListedPackage): string | undefined {
    const npm = parseNpmSource(entry.source);
    if (npm !== undefined) return `npm:${npm.name}`;
    const git = parseGitSource(entry.source);
    if (git !== undefined) return `git:${git.host}/${git.path}`;
    if (entry.folder !== undefined) return `local:${comparisonKey(entry.folder)}`;
    if (path.isAbsolute(entry.source)) return `local:${comparisonKey(entry.source)}`;
    return undefined;
}

/** The package name in a folder's package.json, or undefined when the folder has no readable one. */
export function manifestOf(folder: string): { name?: string; version?: string } | undefined {
    try {
        const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as {
            name?: unknown;
            version?: unknown;
        };
        return {
            ...(typeof manifest.name === "string" ? { name: manifest.name } : {}),
            ...(typeof manifest.version === "string" ? { version: manifest.version } : {}),
        };
    } catch {
        return undefined;
    }
}

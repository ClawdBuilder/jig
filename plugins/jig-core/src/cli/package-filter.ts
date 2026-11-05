// Pi's package filter, read the way Pi reads it (Pi 1.5's package-manager.ts): per resource type, patterns relative to the
// package root, `!` excludes, `+` force-includes, `-` force-excludes, an empty list disables the type, and `autoload:false`
// starts from nothing. Only what the Jig command needs is here: extension files and which Jig plugins they belong to.
import path from "node:path";

export type ResourceType = "extensions" | "skills" | "prompts" | "themes";

export interface PackageFilter {
    autoload?: boolean;
    extensions?: string[];
    skills?: string[];
    prompts?: string[];
    themes?: string[];
}

/** A settings entry's filter, or undefined for a plain string entry (Pi loads everything it names). */
export function filterOf(entry: unknown): PackageFilter | undefined {
    if (typeof entry === "string" || typeof entry !== "object" || entry === null) return undefined;
    const raw = entry as Record<string, unknown>;
    const read = (name: ResourceType): string[] | undefined => {
        const value = raw[name];
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return [];
        return value as string[];
    };
    const extensions = read("extensions");
    const skills = read("skills");
    const prompts = read("prompts");
    const themes = read("themes");
    if (
        raw.autoload !== false &&
        extensions === undefined &&
        skills === undefined &&
        prompts === undefined &&
        themes === undefined
    ) {
        return undefined;
    }
    return {
        ...(raw.autoload === false ? { autoload: false } : {}),
        ...(extensions === undefined ? {} : { extensions }),
        ...(skills === undefined ? {} : { skills }),
        ...(prompts === undefined ? {} : { prompts }),
        ...(themes === undefined ? {} : { themes }),
    };
}

function compileGlob(pattern: string): RegExp {
    let source = "";
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index] ?? "";
        if (char === "*") {
            if (pattern[index + 1] === "*") {
                source += ".*";
                index += 1;
            } else {
                source += "[^/]*";
            }
        } else if (char === "?") {
            source += "[^/]";
        } else if (char === "[") {
            const close = pattern.indexOf("]", index + 1);
            if (close > index + 1) {
                source += `[${pattern.slice(index + 1, close)}]`;
                index = close;
            } else {
                source += "\\[";
            }
        } else {
            source += char.replace(/[.+^${}()|\\]/g, "\\$&");
        }
    }
    return new RegExp(`^${source}$`);
}

/** As Pi's glob matching sees a pattern: separators to `/`, and a leading `./` kept (it never matches a relative path). */
const asGlob = (pattern: string): string => pattern.split(path.sep).join("/");

/** As Pi's exact matching sees a pattern: a leading `./` is stripped. */
const asExact = (pattern: string): string =>
    (pattern.startsWith("./") ? pattern.slice(2) : pattern).split(path.sep).join("/");

/** Matches Pi's matchesAnyPattern for a non-skill file: the relative path, the name, or the absolute path. */
function matches(pattern: string, file: string, root: string): boolean {
    const glob = compileGlob(asGlob(pattern));
    const relative = path.relative(root, file).split(path.sep).join("/");
    const absolute = file.split(path.sep).join("/");
    return glob.test(relative) || glob.test(path.basename(file)) || glob.test(absolute);
}

/** Matches Pi's matchesAnyExactPattern: the relative or absolute path, no glob. */
function matchesExact(pattern: string, file: string, root: string): boolean {
    const target = asExact(pattern);
    return target === path.relative(root, file).split(path.sep).join("/") || target === file.split(path.sep).join("/");
}

function applyPatterns(files: readonly string[], patterns: readonly string[], root: string): Set<string> {
    const includes = patterns.filter((pattern) => !/^[!+-]/.test(pattern));
    const excludes = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
    const forceIncludes = patterns.filter((pattern) => pattern.startsWith("+")).map((pattern) => pattern.slice(1));
    const forceExcludes = patterns.filter((pattern) => pattern.startsWith("-")).map((pattern) => pattern.slice(1));
    let enabled =
        includes.length === 0
            ? [...files]
            : files.filter((file) => includes.some((pattern) => matches(pattern, file, root)));
    if (excludes.length > 0)
        enabled = enabled.filter((file) => !excludes.some((pattern) => matches(pattern, file, root)));
    for (const pattern of forceIncludes) {
        for (const file of files) {
            if (!enabled.includes(file) && matchesExact(pattern, file, root)) enabled.push(file);
        }
    }
    if (forceExcludes.length > 0)
        enabled = enabled.filter((file) => !forceExcludes.some((pattern) => matchesExact(pattern, file, root)));
    return new Set(enabled);
}

/** The files of one type Pi would load, from all files the manifest names. */
export function enabledFiles(
    files: readonly string[],
    filter: PackageFilter | undefined,
    type: ResourceType,
    root: string,
): Set<string> {
    if (filter === undefined) return new Set(files);
    const patterns = filter[type];
    if (patterns === undefined) return filter.autoload === false ? new Set() : new Set(files);
    if (patterns.length === 0) return new Set();
    if (filter.autoload === false) {
        // Delta mode: start with nothing, and each pattern turns the files it names on or off.
        const enabled = new Set<string>();
        for (const pattern of patterns) {
            const off = pattern.startsWith("!") || pattern.startsWith("-");
            const exact = pattern.startsWith("+") || pattern.startsWith("-");
            const body = exact ? asExact(pattern.replace(/^[!+-]/, "")) : asGlob(pattern.replace(/^[!+-]/, ""));
            for (const file of files) {
                const hit = exact ? matchesExact(body, file, root) : matches(body, file, root);
                if (!hit) continue;
                if (off) enabled.delete(file);
                else enabled.add(file);
            }
        }
        return enabled;
    }
    return applyPatterns(files, patterns, root);
}

// Which npm registry Jig asks about a release. `jig update` asks npm itself (`npm config get registry`); the background
// notice must not start a program at session start, so it reads the same inexpensive sources npm reads first: the
// environment, then the project's .npmrc, then the user's .npmrc (and the global one only when NPM_CONFIG_GLOBALCONFIG
// names it), then npm's built-in default. A company mirror in any of those is honoured; an exotic npmrc that only a
// spawned npm can resolve is left to `jig update`.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

/** A registry base with one trailing slash, or undefined when it is not an http(s) URL. */
export function normalizeRegistry(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
        url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
        return url.toString();
    } catch {
        return undefined;
    }
}

/** The `registry=` setting in one .npmrc, or undefined. */
export function registryInNpmrc(file: string): string | undefined {
    if (!existsSync(file)) return undefined;
    let text: string;
    try {
        text = readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
        const equals = line.indexOf("=");
        if (equals < 0) continue;
        if (line.slice(0, equals).trim().toLowerCase() !== "registry") continue;
        const value = line
            .slice(equals + 1)
            .replace(/\s+[#;].*$/, "")
            .trim()
            .replace(/^"(.*)"$/, "$1")
            .replace(/^'(.*)'$/, "$1");
        const normalized = normalizeRegistry(value);
        if (normalized !== undefined) return normalized;
    }
    return undefined;
}

/** Environment, project, user, then the named global config, in npm's precedence order. */
export function registryFor(env: NodeJS.ProcessEnv, home: string = homedir(), cwd: string = process.cwd()): string {
    const fromEnv = normalizeRegistry(env.npm_config_registry) ?? normalizeRegistry(env.NPM_CONFIG_REGISTRY);
    if (fromEnv !== undefined) return fromEnv;
    const project = env.npm_config_projectconfig ?? env.NPM_CONFIG_PROJECTCONFIG ?? path.join(cwd, ".npmrc");
    const user = env.npm_config_userconfig ?? env.NPM_CONFIG_USERCONFIG ?? path.join(home, ".npmrc");
    const global = env.npm_config_globalconfig ?? env.NPM_CONFIG_GLOBALCONFIG;
    for (const file of [project, user, ...(global === undefined ? [] : [global])]) {
        const found = registryInNpmrc(file);
        if (found !== undefined) return found;
    }
    return DEFAULT_REGISTRY;
}

/** The metadata URL for a package in a registry base. A scoped name keeps its `@` and escapes the slash. */
export function registryUrl(base: string, name: string): string {
    const normalized = normalizeRegistry(base) ?? DEFAULT_REGISTRY;
    return new URL(
        name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name),
        normalized,
    ).toString();
}

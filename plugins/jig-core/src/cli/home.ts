// The Jig home: Pi's agent folder for Jig, `~/.jig` or `JIG_HOME`. `jig` is Pi for this folder and nothing else, so every
// command reads it and every Pi command runs with it as PI_CODING_AGENT_DIR. An outer PI_CODING_AGENT_DIR is ignored.
// bin/jig.mjs needs the home before it loads any TypeScript; it repeats these three lines of plain shell-free JavaScript.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { manifestOf, packageFolder } from "./packages.ts";

export const HOME_FOLDER = ".jig";
export const PACKAGE_NAME = "@clawdbuilder/jig";

/** The home: `JIG_HOME`, else `~/.jig`. */
export function jigHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
    const named = env.JIG_HOME?.trim();
    return named === undefined || named === "" ? path.join(home, HOME_FOLDER) : path.resolve(named);
}

/** Where Pi keeps an npm package in the home. */
export function homeNpmFolder(home: string, name: string = PACKAGE_NAME): string {
    return path.join(home, "npm", "node_modules", ...name.split("/"));
}

/** The folder the home's Jig is installed in: the npm copy, or a local package Pi lists (a test's packed copy, say). */
export function homeFolder(home: string, name: string = PACKAGE_NAME): string | undefined {
    const npm = homeNpmFolder(home, name);
    if (existsSync(path.join(npm, "bin", "jig.mjs"))) return npm;
    // Pi records a local or tarball source as the path it was given and copies nothing; the folder may hold Jig itself.
    try {
        const settings = JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8")) as { packages?: unknown };
        for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {
            const source = typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
            if (typeof source !== "string" || source.startsWith("git:")) continue;
            const found = packageFolder(source, home).folder;
            if (found === undefined || !existsSync(path.join(found, "bin", "jig.mjs"))) continue;
            if (manifestOf(found)?.name === name) return found;
        }
    } catch {
        // No settings file, or one that cannot be read: the npm copy is all there is.
    }
    return undefined;
}

/** The `jig` command in the home, or undefined when the home has no Jig. */
export function homeCommand(home: string, name: string = PACKAGE_NAME): string | undefined {
    const folder = homeFolder(home, name);
    return folder === undefined ? undefined : path.join(folder, "bin", "jig.mjs");
}

/** The version of the Jig installed in the home, or undefined when there is none. */
export function homeVersion(home: string, name: string = PACKAGE_NAME): string | undefined {
    const folder = homeFolder(home, name);
    if (folder === undefined) return undefined;
    try {
        const manifest = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")) as { version?: unknown };
        return typeof manifest.version === "string" ? manifest.version : undefined;
    } catch {
        return undefined;
    }
}

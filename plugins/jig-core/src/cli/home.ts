// The Jig home: Pi's agent folder for Jig, `~/.jig` or `JIG_HOME`. `jig` is Pi for this folder and nothing else, so every
// command reads it and every Pi command runs with it as PI_CODING_AGENT_DIR. An outer PI_CODING_AGENT_DIR is ignored.
// bin/jig.mjs needs the home before it loads any TypeScript; it repeats these three lines of plain shell-free JavaScript.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const HOME_FOLDER = ".jig";
export const PACKAGE_NAME = "@clawdbuilder/jig";

/** The home: `JIG_HOME`, else `~/.jig`. */
export function jigHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
    const named = env.JIG_HOME?.trim();
    return named === undefined || named === "" ? path.join(home, HOME_FOLDER) : path.resolve(named);
}

/** Where Pi keeps an npm package in the home. */
export function homePackage(home: string, name: string = PACKAGE_NAME): string {
    return path.join(home, "npm", "node_modules", ...name.split("/"));
}

/** The `jig` command in the home, or undefined when the home has no Jig. */
export function homeCommand(home: string, name: string = PACKAGE_NAME): string | undefined {
    const file = path.join(homePackage(home, name), "bin", "jig.mjs");
    return existsSync(file) ? file : undefined;
}

/** The version of the Jig installed in the home, or undefined when there is none. */
export function homeVersion(home: string, name: string = PACKAGE_NAME): string | undefined {
    try {
        const manifest = JSON.parse(readFileSync(path.join(homePackage(home, name), "package.json"), "utf8")) as {
            version?: unknown;
        };
        return typeof manifest.version === "string" ? manifest.version : undefined;
    } catch {
        return undefined;
    }
}

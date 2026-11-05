// The project files Pi loads outside the sandbox at its next start: its trust-requiring resources (Pi 1.5's
// TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES), the project package folders, and .agents. bash may not write them, and Pi's file
// tools may not write them either: one table, read by both, so a path added to one is added to the other.
import path from "node:path";

/** Relative to a project folder. `.pi/git` and `.pi/npm` hold packages Pi runs; `.agents` holds skills Pi loads. */
export const PI_PROJECT_PATHS: readonly string[] = [
    ".pi/settings.json",
    ".pi/mcp.json",
    ".pi/extensions",
    ".pi/skills",
    ".pi/prompts",
    ".pi/themes",
    ".pi/SYSTEM.md",
    ".pi/APPEND_SYSTEM.md",
    ".pi/git",
    ".pi/npm",
    ".agents",
];

function pathApi(platform: NodeJS.Platform | undefined): typeof path.posix {
    return (platform ?? process.platform) === "win32" ? path.win32 : path.posix;
}

/**
 * The project folder and every folder above it below the home folder, as the sandbox's lock uses them: the working folder
 * first, then its parents, stopping before the home folder (and before the root). None when the working folder is the home
 * folder or above it.
 */
export function projectFoldersBelowHome(cwd: string, home: string, platform?: NodeJS.Platform): string[] {
    const api = pathApi(platform);
    const out: string[] = [];
    let current = api.resolve(cwd);
    for (;;) {
        if (current === home || current === api.parse(current).root) break;
        out.push(current);
        const parent = api.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return out;
}

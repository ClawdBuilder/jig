// Pi's project trust, read without importing Pi: trust.json in the agent folder holds canonical folder paths with true,
// false or null, and the closest decision wins (Pi 1.5's trust-manager.ts); without one, only the agent folder's
// settings.json defaultProjectTrust decides, and "always" is the only value that loads project packages outside Pi's UI.
// A missing, unreadable or malformed file fails closed. The project_trust extension event is not imitated: this command has
// no screen for it, and under-loading is the safe direction.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export interface TrustReading {
    /** Whether Pi would load the folder's project packages. */
    trusted: boolean;
    /** Why, in plain words, for a skip line: set when they are not loaded and this is about trust without a problem. */
    reason?: string;
    /** A trust file or settings file that could not be read: the packages are not loaded. */
    problem?: string;
    /** "saved" when trust.json decided, "default" when defaultProjectTrust did. */
    source?: "saved" | "default";
}

/** Pi's path comparison: the resolved path, case-folded on Windows because Windows paths are case-insensitive. */
function comparisonKey(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** The folder itself, with symlinks resolved when it exists, as Pi canonicalizes a cwd for trust. */
function canonicalFolder(value: string): string {
    try {
        return realpathSync(value);
    } catch {
        return path.resolve(value);
    }
}

interface TrustFile {
    entries: Array<{ key: string; decision: boolean | null }>;
    problem?: string;
}

function readTrustFile(file: string): TrustFile {
    if (!existsSync(file)) return { entries: [] };
    let raw: unknown;
    try {
        const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
        raw = JSON.parse(text) as unknown;
    } catch (error) {
        return {
            entries: [],
            problem: `Pi's trust file could not be read: ${file} (${error instanceof Error ? error.message : String(error)})`,
        };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { entries: [], problem: `Pi's trust file is not an object: ${file}` };
    }
    const entries: Array<{ key: string; decision: boolean | null }> = [];
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value !== true && value !== false && value !== null) {
            return {
                entries: [],
                problem: `Pi's trust file has a value that is not true, false or null for ${JSON.stringify(key)}: ${file}`,
            };
        }
        entries.push({ key, decision: value });
    }
    return { entries };
}

/** The agent folder's defaultProjectTrust: only the agent settings, never the project's, and "always" is the only yes. */
function defaultTrust(agentDir: string): { trusted: boolean; value?: string; problem?: string } {
    const file = path.join(agentDir, "settings.json");
    if (!existsSync(file)) return { trusted: false };
    try {
        const raw = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as unknown;
        const value =
            typeof raw === "object" && raw !== null
                ? (raw as { defaultProjectTrust?: unknown }).defaultProjectTrust
                : undefined;
        if (value === undefined) return { trusted: false };
        if (value === "always") return { trusted: true, value };
        if (value === "never" || value === "ask") return { trusted: false, value };
        return {
            trusted: false,
            problem: `Pi's settings have defaultProjectTrust ${JSON.stringify(value)}; Jig reads only always, never or ask.`,
        };
    } catch (error) {
        return {
            trusted: false,
            problem: `Pi's settings could not be read: ${file} (${error instanceof Error ? error.message : String(error)})`,
        };
    }
}

/** Whether Pi would load the project packages of `cwd`, by its own saved decisions and default. */
export function projectTrust(agentDir: string, cwd: string): TrustReading {
    const trust = readTrustFile(path.join(agentDir, "trust.json"));
    if (trust.problem !== undefined) {
        return {
            trusted: false,
            problem: `${trust.problem} This folder's Pi packages were not loaded.`,
        };
    }
    let dir = canonicalFolder(cwd);
    for (;;) {
        const key = comparisonKey(dir);
        const found = trust.entries.find((entry) => comparisonKey(entry.key) === key && entry.decision !== null);
        if (found !== undefined) {
            return found.decision === true
                ? { trusted: true, source: "saved" }
                : {
                      trusted: false,
                      source: "saved",
                      reason: `This folder was marked "not trusted" in Pi (${dir}).`,
                  };
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    const fallback = defaultTrust(agentDir);
    if (fallback.problem !== undefined)
        return { trusted: false, problem: `${fallback.problem} This folder's Pi packages were not loaded.` };
    if (fallback.trusted) return { trusted: true, source: "default" };
    return {
        trusted: false,
        source: "default",
        reason: "you have not trusted this folder in Pi",
    };
}

/** The skip line's words: what was skipped, and what to do about it. `sources` are the settings entries. */
export function untrustedSkipLine(sources: readonly string[], reading: TrustReading): string {
    const named = sources.length === 0 ? "this folder's Pi packages" : sources.join(", ");
    const because =
        reading.problem ??
        (reading.source === "saved" ? `it was marked "not trusted" in Pi` : `you have not trusted this folder in Pi`);
    return `This folder's Pi packages were not loaded (${named}), because ${because}. Open Pi here and choose Trust, then run jig doctor again.`;
}

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
    /** Why, in plain words: shown after "not loaded" when they are not. */
    reason?: string;
    /** The doctor's fix line. */
    fix?: string;
    /** Which kind of decision, for the setup wording. */
    kind?: "default" | "marked" | "damaged-trust" | "damaged-settings" | "unknown-setting";
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
    } catch {
        return { entries: [], problem: `Pi's trust file is damaged: ${file}` };
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { entries: [], problem: `Pi's trust file is damaged: ${file}` };
    }
    const entries: Array<{ key: string; decision: boolean | null }> = [];
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value !== true && value !== false && value !== null) {
            return { entries: [], problem: `Pi's trust file is damaged: ${file}` };
        }
        entries.push({ key, decision: value });
    }
    return { entries };
}

/** The agent folder's defaultProjectTrust: only the agent settings, never the project's, and "always" is the only yes. */
function defaultTrust(agentDir: string): {
    trusted: boolean;
    value?: string;
    kind?: TrustReading["kind"];
    reason?: string;
    fix?: string;
} {
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
            kind: "unknown-setting",
            reason: `Pi's defaultProjectTrust is ${JSON.stringify(value)}; Jig reads only always, never or ask.`,
            fix: `Open ${file} and set defaultProjectTrust to always, never or ask, then run jig doctor again.`,
        };
    } catch {
        return {
            trusted: false,
            kind: "damaged-settings",
            reason: `Pi's settings file needs repairing: ${file}`,
            fix: "Open that file and fix it. Pi will not start cleanly until it is valid.",
        };
    }
}

/** Whether Pi would load the project packages of `cwd`, by its own saved decisions and default. */
export function projectTrust(agentDir: string, cwd: string): TrustReading {
    const trust = readTrustFile(path.join(agentDir, "trust.json"));
    if (trust.problem !== undefined) {
        return {
            trusted: false,
            kind: "damaged-trust",
            reason: trust.problem,
            fix: "Open that file and repair it, or delete it and choose Trust in Pi again.",
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
                      kind: "marked",
                      reason: "it was marked not trusted in Pi",
                      fix: "Run /trust in Pi to change it, then run jig doctor again.",
                  };
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    const fallback = defaultTrust(agentDir);
    if (fallback.kind !== undefined) return fallback;
    if (fallback.trusted) return { trusted: true, source: "default" };
    return {
        trusted: false,
        source: "default",
        kind: "default",
        reason: "you have not trusted this folder in Pi",
        fix: "Open Pi here and choose Trust, then run jig doctor again.",
    };
}

/** The doctor's detail for skipped project packages: what, and why, without repeating the fix. */
export function untrustedDetail(sources: readonly string[], reading: TrustReading): string {
    const named = sources.length === 0 ? "this folder's Pi packages" : sources.join(", ");
    return `not loaded (${named}): ${reading.reason ?? "the folder is not trusted in Pi"}`;
}

/** The whole sentence setup shows, naming setup and the way out of each kind of decision. */
export function untrustedSetupLine(sources: readonly string[], reading: TrustReading): string {
    const named = sources.length === 0 ? "this folder's Pi packages" : sources.join(", ");
    const wayOut =
        reading.kind === "marked"
            ? "Run /trust in Pi to change it, or run jig setup from another folder."
            : reading.kind === "damaged-trust"
              ? "Open that file and repair it, or delete it and choose Trust in Pi again."
              : reading.kind === "damaged-settings"
                ? "Open that file and fix it; Pi will not start cleanly until it is valid."
                : reading.kind === "unknown-setting"
                  ? "Open that file and set defaultProjectTrust to always, never or ask."
                  : "Open Pi here and choose Trust, or run jig setup from another folder.";
    return `This folder's Pi packages were not loaded (${named}): ${reading.reason ?? "the folder is not trusted in Pi"}. ${wayOut}`;
}

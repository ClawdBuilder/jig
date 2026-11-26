// The update notice inside Pi: a background check at most once a day, silent when offline or when the person (or a company
// default) turned it off. It tells the person only, through the screen; the model's context is never touched.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { companyRanges } from "./update-company.ts";
import { installMode } from "./install-mode.ts";
import { compareVersions, currentPiRequirement, jigPackage, reportedPiVersion } from "./pi-version.ts";
import { readPackages } from "./cli/packages.ts";
import { privateFolder, replacePrivateFile, stateDir } from "./paths.ts";
import { registryFor, registryUrl } from "./registry.ts";
import type { JigState } from "./engine-state.ts";
import { availableNotice, deprecatedNotice, isPinned, piNewerNotice } from "./update-notice-text.ts";
import { selectTarget } from "./update-versions.ts";
import type { RegistryMetadata } from "./update-versions.ts";
import { readUpdates } from "./updates-section.ts";

const DAY = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT = 5000;

interface Cache {
    schema: 1;
    checkedAt?: number;
    failedAt?: number;
    latest?: string;
    piWarned?: string;
}

const RETRY_AFTER_FAILURE = 60 * 60 * 1000;

export interface NoticeOptions {
    /** A test can answer the registry without a network. */
    fetchJson?: (url: string) => Promise<unknown>;
    /** A test can move the clock. */
    now?: number;
    /** Pi's own version, as a session passes it (`0.0.0` is unknown); a test can name one. Unknown: the package is read. */
    pi?: string;
    /** A test can replace the read of Pi's package, which stands in when Pi's own version is unknown. */
    readPi?: () => string | undefined;
}

function readCache(file: string): Cache {
    try {
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (typeof value === "object" && value !== null && (value as Cache).schema === 1) return value as Cache;
    } catch {
        // No cache, or one this version does not read: check again.
    }
    return { schema: 1 };
}

function writeCache(file: string, cache: Cache): void {
    try {
        // The state folder's rule: folders 0700 and files 0600, and an older loose one is tightened.
        privateFolder(path.dirname(file));
        replacePrivateFile(file, JSON.stringify(cache));
    } catch {
        // A notice must never affect the session; the next start tries again.
    }
}

async function defaultFetch(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    timer.unref?.();
    try {
        const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
        if (!response.ok) throw new Error(`registry ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/** Whether the notice setting is on; an absent section means on. */
export function updateCheckEnabled(section: unknown): boolean {
    return readUpdates(section)?.check !== false;
}

/**
 * Runs after a session starts, in the background. It tells the person when a newer stable Jig exists, when the running
 * version is deprecated, or once when Pi is newer than the tested one. It never throws and never shows anything to the model.
 */
export async function checkUpdateAtStart(
    state: JigState,
    notify: (message: string, level: "info" | "warning") => void,
    options: NoticeOptions = {},
): Promise<void> {
    try {
        if (!updateCheckEnabled(state.personal.sections.get("updates"))) return;
        const own = jigPackage();
        const name = own.name;
        const current = own.version;
        if (name === undefined || current === undefined) return;
        const now = options.now ?? state.now().getTime();
        const file = path.join(stateDir(state.env), "update-check.json");
        const cache = readCache(file);

        const agentDir = state.agentDir();
        const mode = installMode(agentDir);
        const pi = reportedPiVersion(() => options.pi) ?? reportedPiVersion(options.readPi);
        const requirement = currentPiRequirement();
        if (pi !== undefined && compareVersions(pi, requirement.tested) > 0 && cache.piWarned !== pi) {
            notify(piNewerNotice(mode, pi, requirement.tested), "warning");
            cache.piWarned = pi;
            writeCache(file, cache);
        }

        if (state.env.PI_OFFLINE !== undefined && state.env.PI_OFFLINE !== "") return;
        if (cache.failedAt !== undefined && now - cache.failedAt < RETRY_AFTER_FAILURE) return;
        if (cache.checkedAt !== undefined && now - cache.checkedAt < DAY) return;

        // No program at session start: read the npmrc sources npm reads first. jig update asks npm itself, so a mirror
        // that only npm can resolve is still used there.
        const registry = registryFor(state.env, homedir(), state.workingDir, name);
        const metadata = (await (options.fetchJson ?? defaultFetch)(registryUrl(registry, name))) as RegistryMetadata;
        const listed = agentDir === "" ? [] : readPackages(agentDir, state.workingDir).listed;
        const chosen = selectTarget(metadata, companyRanges(listed, name));
        if ("problem" in chosen) return;
        const deprecated = metadata.versions?.[current]?.deprecated;
        if (deprecated !== undefined) {
            const clean = deprecated
                .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            notify(deprecatedNotice(mode, name, current, clean.slice(0, 200), chosen.target.version), "warning");
        } else if (compareVersions(chosen.target.version, current) > 0) {
            const text = availableNotice({
                mode,
                packageName: name,
                current,
                target: chosen.target.version,
                capped: chosen.target.cappedBy.length > 0,
                pinned: isPinned(listed, name),
            });
            if (text !== undefined) notify(text, "info");
        }
        writeCache(file, {
            schema: 1,
            checkedAt: now,
            ...(compareVersions(chosen.target.version, current) > 0 ? { latest: chosen.target.version } : {}),
            ...(cache.piWarned === undefined ? {} : { piWarned: cache.piWarned }),
        });
    } catch {
        // Offline, a bad registry answer or an unreadable folder: a session start must not be delayed or failed. Back
        // off for an hour so a dead registry is not retried on every start.
        try {
            const now = options.now ?? state.now().getTime();
            const file = path.join(stateDir(state.env), "update-check.json");
            writeCache(file, { ...readCache(file), schema: 1, failedAt: now });
        } catch {
            // Nothing to do.
        }
    }
}

// The update notice inside Pi: a background check at most once a day, silent when offline or when the person (or a company
// default) turned it off. It tells the person only, through the screen; the model's context is never touched.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { companyRanges } from "./update-company.ts";
import { compareVersions, currentPiRequirement, jigPackage, piVersion } from "./pi-version.ts";
import { readPackages } from "./cli/packages.ts";
import { stateDir } from "./paths.ts";
import { registryFor, registryUrl } from "./registry.ts";
import type { JigState } from "./state.ts";
import { selectTarget } from "./update-versions.ts";
import type { RegistryMetadata } from "./update-versions.ts";
import { readUpdates } from "./updates-section.ts";

const DAY = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT = 5000;

interface Cache {
    schema: 1;
    checkedAt?: number;
    latest?: string;
    piWarned?: string;
}

export interface NoticeOptions {
    /** A test can answer the registry without a network. */
    fetchJson?: (url: string) => Promise<unknown>;
    /** A test can move the clock. */
    now?: number;
    /** A test can name Pi's version; the real one is read from the package. */
    pi?: string;
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
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(cache));
    } catch {
        // A notice must never affect the session; the next start tries again.
    }
}

async function defaultFetch(url: string): Promise<unknown> {
    const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(CHECK_TIMEOUT),
    });
    if (!response.ok) throw new Error(`registry ${response.status}`);
    return await response.json();
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

        const pi = options.pi ?? piVersion();
        const requirement = currentPiRequirement();
        if (pi !== undefined && compareVersions(pi, requirement.tested) > 0 && cache.piWarned !== pi) {
            notify(
                `Pi ${pi} is newer than ${requirement.tested}, the version Jig is tested with. If something stops working, use jig update in a terminal.`,
                "warning",
            );
            cache.piWarned = pi;
            writeCache(file, cache);
        }

        if (state.env.PI_OFFLINE !== undefined && state.env.PI_OFFLINE !== "") return;
        if (cache.checkedAt !== undefined && now - cache.checkedAt < DAY) return;

        // No program at session start: read the npmrc sources npm reads first. jig update asks npm itself, so a mirror
        // that only npm can resolve is still used there.
        const registry = registryFor(state.env, homedir(), state.workingDir);
        const metadata = (await (options.fetchJson ?? defaultFetch)(registryUrl(registry, name))) as RegistryMetadata;
        const agentDir = state.agentDir();
        const company = agentDir === "" ? [] : companyRanges(readPackages(agentDir, state.workingDir).listed, name);
        const chosen = selectTarget(metadata, company);
        if ("problem" in chosen) return;
        const deprecated = metadata.versions?.[current]?.deprecated;
        if (deprecated !== undefined) {
            notify(
                `Jig ${current} is deprecated on npm: ${deprecated.slice(0, 200)}. Run jig update in a terminal now.`,
                "warning",
            );
        } else if (compareVersions(chosen.target.version, current) > 0) {
            const capped =
                chosen.target.cappedBy.length === 0 ? "" : ` Your company allows up to ${chosen.target.version}.`;
            notify(
                `Jig ${chosen.target.version} is available (you have ${current}). Run jig update in a terminal.${capped}`,
                "info",
            );
        }
        writeCache(file, {
            schema: 1,
            checkedAt: now,
            ...(compareVersions(chosen.target.version, current) > 0 ? { latest: chosen.target.version } : {}),
            ...(cache.piWarned === undefined ? {} : { piWarned: cache.piWarned }),
        });
    } catch {
        // Offline, a bad registry answer or an unreadable folder: a session start must not be delayed or failed.
    }
}

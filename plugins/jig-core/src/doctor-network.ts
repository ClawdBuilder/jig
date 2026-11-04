// The network part of `/jig doctor`, and only with `--network`: one TCP connection to each configured host, in parallel,
// with a 3-second limit and nothing sent. The hosts are the ones in `startChecks` and the addresses written in the
// plugin sections. The latest release is read from the repository field of Jig's own package.json and cached for a day.
//
// Nothing here signs in or sends a credential. A failure is a `warn` or a `skip`, never a `fail`: a host on a VPN that
// is not connected must not make the whole setup look broken.
import { mkdirSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";
import type { DoctorContext, DoctorLine, DoctorOptions } from "./doctor.ts";
import { sectionTexts } from "./doctor-secrets.ts";
import { replaceFileDurably } from "./kit/files.ts";
import { compareVersions, installLocation, jigPackage } from "./pi-version.ts";
import { createStartChecks, splitTcp } from "./start-checks.ts";
import type { StartCheck } from "./start-checks.ts";
import { realTimers } from "./watch/timers.ts";

/** The most hosts one report connects to: one parallel wave, 3 seconds each. */
const MAX_HOSTS = 16;
const RELEASE_TTL_MS = 24 * 60 * 60 * 1000;
const RELEASE_TIMEOUT_MS = 3000;
const CACHE_NAME = "doctor-release.json";
/** `startChecks` allows 40 characters for a name. */
const MAX_NAME = 40;

export interface DoctorHost extends StartCheck {
    /** Where the host came from: the person's list, or an address in a plugin's section. */
    origin: "startChecks" | "sections";
}

/** Every host the settings name, `startChecks` first, each host and port once. */
export function collectHosts(context: DoctorContext): { hosts: DoctorHost[]; dropped: number } {
    const hosts: DoctorHost[] = [];
    const seen = new Set<string>();
    let dropped = 0;
    const add = (check: StartCheck, origin: DoctorHost["origin"]): void => {
        const key = `${check.host.toLowerCase()}:${check.port}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (hosts.length >= MAX_HOSTS) {
            dropped++;
            return;
        }
        hosts.push({ ...check, origin });
    };

    for (const check of context.personal.config.startChecks) add(check, "startChecks");
    for (const text of sectionTexts(context)) {
        const check = checkFromText(text);
        if (check !== undefined) add(check, "sections");
    }
    return { hosts, dropped };
}

/** The network checks. Without `--network` this is one line that says so, and nothing is contacted. */
export async function networkChecks(context: DoctorContext, options: DoctorOptions): Promise<DoctorLine[]> {
    if (options.network !== true) {
        return [
            {
                id: "network.off",
                group: "network",
                level: "skip",
                title: "Network",
                detail: "Network checks are off. Add --network to test the configured hosts.",
            },
        ];
    }

    const { hosts, dropped } = collectHosts(context);
    const lines: DoctorLine[] = [];
    if (hosts.length === 0) {
        lines.push({
            id: "network.hosts",
            group: "network",
            level: "skip",
            title: "Hosts",
            detail: "No host is configured in startChecks or in your sections.",
        });
    } else {
        const checks = createStartChecks({
            ...(options.connect === undefined ? {} : { connect: options.connect }),
            timers: options.timers ?? realTimers,
        });
        // The signal is never aborted: each check has its own 3-second limit, and a person should get every answer.
        await checks.run(hosts, () => undefined, new AbortController().signal);
        for (const [index, host] of hosts.entries()) {
            const result = checks.last(host);
            const fix =
                result === "not reachable"
                    ? (host.hint ?? "Check the host, or your VPN or proxy, then run /jig doctor --network again.")
                    : undefined;
            lines.push({
                id: `network.check.${index}`,
                group: "network",
                level: result === "reachable" ? "ok" : result === "not reachable" ? "warn" : "skip",
                title: host.name,
                detail:
                    result === "reachable"
                        ? `Reachable at ${host.tcp}.`
                        : result === "not reachable"
                          ? `Not reachable at ${host.tcp}.`
                          : `The check did not finish (${host.tcp}).`,
                ...(fix === undefined ? {} : { fix }),
                data: { host: host.host, port: host.port },
            });
        }
    }
    if (dropped > 0) {
        lines.push({
            id: "network.hosts.more",
            group: "network",
            level: "skip",
            title: "More hosts",
            detail: `${dropped} more were not checked; one report checks at most ${MAX_HOSTS}.`,
        });
    }
    lines.push(await releaseLine(context, options));
    return lines;
}

/** The latest release, from the GitHub API, if the package's repository is on GitHub. Never a failure: a skip. */
export async function releaseLine(context: DoctorContext, options: DoctorOptions): Promise<DoctorLine> {
    const pkg = jigPackage();
    const current = options.jigVersion === null ? undefined : (options.jigVersion ?? pkg.version);
    if (current === undefined) {
        return {
            id: "network.release",
            group: "network",
            level: "skip",
            title: "Latest Jig release",
            detail: "Jig's version could not be read, so there is nothing to compare.",
        };
    }
    const repository = options.jigRepository ?? pkg.repository;
    const location = installLocation(repository);
    if (location === undefined) {
        return {
            id: "network.release",
            group: "network",
            level: "skip",
            title: "Latest Jig release",
            detail: "The package does not say where its repository is.",
        };
    }
    const parts = location.split("/");
    const host = parts[0] ?? "";
    if (host !== "github.com" || parts.length !== 3) {
        return {
            id: "network.release",
            group: "network",
            level: "skip",
            title: "Latest Jig release",
            detail: `The latest release is only checked for a GitHub repository; this one is on ${host}.`,
        };
    }
    const url = `https://api.github.com/repos/${encodeURIComponent(parts[1] ?? "")}/${encodeURIComponent(
        parts[2] ?? "",
    )}/releases/latest`;
    const cached = readReleaseCache(context.stateDir, url, context.now());
    if (cached !== undefined) return releaseResult(cached, current);

    try {
        const reply = await (options.fetchText ?? fetchRelease)(url, AbortSignal.timeout(RELEASE_TIMEOUT_MS));
        if (reply.status !== 200) {
            return {
                id: "network.release",
                group: "network",
                level: "skip",
                title: "Latest Jig release",
                detail: `The release page answered with HTTP ${reply.status}, so it was not checked.`,
            };
        }
        const latest = releaseTag(reply.text);
        if (latest === undefined) {
            return {
                id: "network.release",
                group: "network",
                level: "skip",
                title: "Latest Jig release",
                detail: "The release page did not name a version.",
            };
        }
        try {
            writeReleaseCache(context.stateDir, url, latest, context.now());
        } catch {
            // The answer still stands; the next run asks again.
        }
        return releaseResult(latest, current);
    } catch {
        return {
            id: "network.release",
            group: "network",
            level: "skip",
            title: "Latest Jig release",
            detail: "The release page could not be reached.",
        };
    }
}

/** Where the one-day release cache lives. */
export function releaseCacheFile(stateDir: string): string {
    return path.join(stateDir, CACHE_NAME);
}

/** The cached latest release for this URL, when it is at most a day old. */
export function readReleaseCache(stateDir: string, url: string, now: Date): string | undefined {
    try {
        const value: unknown = JSON.parse(readFileSync(releaseCacheFile(stateDir), "utf8"));
        if (typeof value !== "object" || value === null) return undefined;
        const cache = value as { schema?: unknown; url?: unknown; checkedAt?: unknown; latest?: unknown };
        if (
            cache.schema !== 1 ||
            cache.url !== url ||
            typeof cache.checkedAt !== "string" ||
            typeof cache.latest !== "string" ||
            !/^\d+\.\d+\.\d+$/.test(cache.latest)
        ) {
            return undefined;
        }
        const at = Date.parse(cache.checkedAt);
        if (!Number.isFinite(at)) return undefined;
        const age = now.getTime() - at;
        if (age < 0 || age > RELEASE_TTL_MS) return undefined;
        return cache.latest;
    } catch {
        return undefined;
    }
}

/** Writes the cache privately. A failure is the caller's to ignore. */
export function writeReleaseCache(stateDir: string, url: string, latest: string, now: Date): void {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    replaceFileDurably(
        releaseCacheFile(stateDir),
        `${JSON.stringify({ schema: 1, url, checkedAt: now.toISOString(), latest })}\n`,
        0o600,
    );
}

/** A host from one settings string: an `http(s)` address, or a `host:port` with a real host in it. */
function checkFromText(text: string): StartCheck | undefined {
    const trimmed = text.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        let url: URL;
        try {
            url = new URL(trimmed);
        } catch {
            return undefined;
        }
        const host = url.hostname.replace(/^\[|\]$/g, "");
        const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
        if (!plausibleHost(host) || !validPort(port) || host.length > MAX_NAME) return undefined;
        return { name: host, tcp: address(host, port), host, port };
    }
    if (trimmed.includes("/") || trimmed.includes("://")) return undefined;
    const split = splitTcp(trimmed);
    if (split === undefined || !plausibleHost(split.host) || split.host.length > MAX_NAME) return undefined;
    return { name: split.host, tcp: address(split.host, split.port), host: split.host, port: split.port };
}

/** A hostname or an IP address, not a bare number or a word that happens to have a colon. */
function plausibleHost(host: string): boolean {
    const lower = host.toLowerCase();
    return (
        lower.length > 0 &&
        lower.length <= 253 &&
        (isIP(lower) !== 0 || lower === "localhost" || (lower.includes(".") && !/\s/.test(lower)))
    );
}

function validPort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function address(host: string, port: number): string {
    return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function releaseResult(latest: string, current: string): DoctorLine {
    const data = { latest, current };
    return compareVersions(latest, current) > 0
        ? {
              id: "network.release",
              group: "network",
              level: "warn",
              title: "Latest Jig release",
              detail: `A newer release is out: ${latest} (you have ${current}).`,
              fix: "Update Jig: pi update.",
              data,
          }
        : {
              id: "network.release",
              group: "network",
              level: "ok",
              title: "Latest Jig release",
              detail: `You have ${current}; the latest release is ${latest}.`,
              data,
          };
}

function releaseTag(text: string): string | undefined {
    try {
        const value: unknown = JSON.parse(text);
        if (typeof value !== "object" || value === null) return undefined;
        const tag = (value as { tag_name?: unknown }).tag_name;
        if (typeof tag !== "string") return undefined;
        const match = /^v?(\d+\.\d+\.\d+)/i.exec(tag.trim());
        return match?.[1];
    } catch {
        return undefined;
    }
}

/** One plain GET, no credential, no cookie, and a cap on what is read. */
async function fetchRelease(url: string, signal: AbortSignal): Promise<{ status: number; text: string }> {
    const reply = await fetch(url, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "jig-doctor" },
        signal,
        redirect: "follow",
    });
    return { status: reply.status, text: (await reply.text()).slice(0, 200_000) };
}

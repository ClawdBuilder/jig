// Who a `fetch` talks to. A fetch is a read, and reads do not ask, but it is the one read that offers the user's SSH key
// outward: git connects to the remote's host with the agent's key. Which host that is comes from the repository's own
// configuration, and the agent can write `.git/config` from the sandbox (`git remote add`, `git remote set-url origin`), so
// comparing against origin proves nothing. The hosts trusted without a question are therefore the ones the user's own
// configuration names as forges — github.com, gitlab.com, `git.cloneHost` and the hosts of `git.forges` — and every other
// host asks, naming it. A "this session" answer is remembered for that host, so a fork workflow asks once.
//
// This is a gate, not a classification: `classify` sees only the input, before the repository is read, so it cannot know
// the host. A gate may make a decision stricter, and this one turns the read's allow into an ask for one host at a time.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Gate, GateCall, GateVerdict } from "../../jig-core/src/contract.ts";
import { gitSettings } from "./config.ts";
import type { GitSettings } from "./config.ts";
import { checkRemote } from "./names.ts";
import { originHost, GITHUB_COM, GITLAB_COM, isSshOrigin } from "./origin-host.ts";
import { resolveRepo } from "./repo.ts";
import { git, scrub } from "./run.ts";

/** The gate's name, as `/jig` shows it. */
export const FETCH_GATE = "git-fetch-host";

/** jig-core publishes every decision on Pi's event bus under this name (`JIG_EVENTS.decision`). The contract is imported
 *  as types only (the plugin's rules test asks for that), and this is the one value it needs. */
const DECISION_EVENT = "jig:decision";

/** What a remote address is: a local path, a host, or text that cannot be read as either. */
export type RemoteAddress = { kind: "local" } | { kind: "host"; host: string } | { kind: "unknown"; shown: string };

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

/**
 * The address as git reads it. A local path — absolute, `./` or `../`, `~/`, a Windows drive, `file://`, or a name with no
 * colon — reaches no host and offers no key. A host is read from a URL's authority or from git's scp-like `host:path`,
 * with or without a user. Anything else is `unknown`, and the gate asks about it: a form this function cannot read is not
 * a reason to let a fetch run.
 */
export function addressOf(url: string, platform: NodeJS.Platform = process.platform): RemoteAddress {
    const text = url.trim();
    if (text === "") return { kind: "unknown", shown: "" };
    const scheme = SCHEME.exec(text);
    if (scheme !== null) {
        if (scheme[1]?.toLowerCase() === "file") return { kind: "local" };
        const rest = text.slice(scheme[0].length);
        const authority = rest.split(/[/?#]/)[0] ?? "";
        const hostPart = authority.includes("@") ? authority.slice(authority.lastIndexOf("@") + 1) : authority;
        const host = hostPart
            .replace(/:\d+$/, "")
            .replace(/^\[([^\]]+)\]$/, "$1")
            .toLowerCase();
        return host === "" ? { kind: "unknown", shown: text } : { kind: "host", host };
    }
    // A drive prefix is a path only on Windows, where git reads it as one. Everywhere else git reads `C:/repos/x` as an
    // scp-like address to the host "C", which a DNS search domain can resolve, so it must ask rather than pass.
    if (platform === "win32" && /^[A-Za-z]:[\\/]/.test(text)) return { kind: "local" };
    // scp-like with a user.
    const withUser = /^[^@/\s]+@([^/:\s]+):/.exec(text);
    if (withUser !== null) return { kind: "host", host: (withUser[1] as string).toLowerCase() };
    const colon = text.indexOf(":");
    const slash = text.indexOf("/");
    // scp-like without a user: `host:path`, a colon before any slash. Git reads it as ssh.
    if (colon > 0 && (slash === -1 || colon < slash)) {
        const host = text.slice(0, colon);
        return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(host)
            ? { kind: "host", host: host.toLowerCase() }
            : { kind: "unknown", shown: text };
    }
    // A path, absolute or relative, or a plain name: nothing is reached over ssh.
    return { kind: "local" };
}

/** The hosts the user's own configuration treats as forges: never asked about. */
export function trustedHosts(settings: GitSettings): Set<string> {
    const hosts = new Set([GITHUB_COM, GITLAB_COM]);
    if (settings.cloneHost !== "") hosts.add(settings.cloneHost.toLowerCase());
    for (const [host, entry] of Object.entries(settings.forges ?? {})) {
        hosts.add(host.toLowerCase());
        if (typeof entry === "object" && entry.host !== undefined) hosts.add(entry.host.toLowerCase());
    }
    return hosts;
}

/** Whether a fetch to this host runs without a question: a forge the user's configuration names, or one allowed this session. */
export function isTrustedHost(host: string, settings: GitSettings, allowed: ReadonlySet<string> = new Set()): boolean {
    return trustedHosts(settings).has(host) || allowed.has(host);
}

/** What the question is about, for one address of the remote. */
export interface FetchTarget {
    /** The text the question names, as the address shows it, scrubbed. */
    shown: string;
    /** What a session answer is filed under: the host, or the unreadable address. */
    key: string;
    /** The host the address names, when it names one. */
    host?: string;
    /** The real host behind an ssh alias, which the configuration may name instead. */
    real?: string;
}

/** What the gate decided about a fetch: every address of the remote that needs a question. */
export interface FetchCheck {
    /** True when the call is a fetch this gate has something to say about. */
    fetch: boolean;
    /** One entry per address that is not a local path. Empty when nothing can be reached over ssh. */
    targets: FetchTarget[];
}

/**
 * Every URL a remote has, in the order git holds them. `--get-all` rather than `--get`: a remote can hold several, and
 * `--get` prints only the last while fetch uses the first, which is a way to show the gate one address and fetch another.
 */
async function remoteUrls(
    repo: string,
    remote: string,
    signal?: AbortSignal,
): Promise<{ ok: true; urls: string[] } | { ok: false }> {
    try {
        const result = await git(repo, ["config", "--get-all", `remote.${remote}.url`], { signal, timeoutMs: 3000 });
        if (result.timedOut) return { ok: false };
        if (result.code === 0) {
            return {
                ok: true,
                urls: result.stdout
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line !== ""),
            };
        }
        // A remote with no URL at all: nothing to read, so nothing to trust.
        return result.code === 1 && result.stdout.trim() === "" ? { ok: true, urls: [] } : { ok: false };
    } catch {
        return { ok: false };
    }
}

const shownAddress = (url: string, remote: string): string => {
    const scrubbed = scrub(url).trim();
    const shown = scrubbed === "" ? `remote ${remote}` : scrubbed;
    return shown.length > 80 ? `${shown.slice(0, 80)}...` : shown;
};

/** Reads the call's repository and remote, and says what I would ask about. A call the tool would refuse anyway gets no target. */
export async function inspectFetch(
    call: Pick<GateCall, "tool" | "action" | "input">,
    signal?: AbortSignal,
): Promise<FetchCheck> {
    if (call.tool !== "git" || call.action !== "fetch") return { fetch: false, targets: [] };
    const input = call.input as { repo?: unknown; remote?: unknown };
    let remote: string;
    try {
        remote = input.remote === undefined ? "origin" : checkRemote(input.remote);
    } catch {
        return { fetch: true, targets: [] };
    }
    let root: string;
    try {
        root = (await resolveRepo(typeof input.repo === "string" ? input.repo : undefined, signal)).root;
    } catch {
        return { fetch: true, targets: [] };
    }
    const listed = await remoteUrls(root, remote, signal);
    if (!listed.ok) {
        // The addresses could not be read: ask about the remote itself rather than let it run unblessed.
        const shown = `remote ${remote}`;
        return { fetch: true, targets: [{ shown, key: `?${shown}` }] };
    }
    if (listed.urls.length === 0) {
        const shown = `remote ${remote}`;
        return { fetch: true, targets: [{ shown, key: `?${shown}` }] };
    }
    const targets: FetchTarget[] = [];
    for (const url of listed.urls) {
        const address = addressOf(url);
        if (address.kind === "local") continue;
        if (address.kind === "unknown") {
            const shown = shownAddress(url, remote);
            targets.push({ shown, key: `?${shown}` });
            continue;
        }
        // An ssh alias stands for the host `ssh -G` names, and the configuration may name either.
        const real = isSshOrigin(url) ? (await originHost(url, address.host, gitSettings())).real : address.host;
        targets.push({ shown: address.host, key: address.host, host: address.host, real });
    }
    return { fetch: true, targets };
}

/** Whether one target needs no question: its host, its real host, or its address was allowed this session. */
export function isTrustedTarget(
    target: FetchTarget,
    settings: GitSettings,
    allowed: ReadonlySet<string> = new Set(),
): boolean {
    if (allowed.has(target.key)) return true;
    if (target.host === undefined) return false;
    return (
        isTrustedHost(target.host, settings, allowed) ||
        (target.real !== undefined && isTrustedHost(target.real, settings, allowed))
    );
}

/** A gate and the session's memory of the hosts the user allowed, which the answer to the question provides. */
export interface FetchGuard {
    gate: Gate;
    /** Forgets the session's answers and stops listening for them. */
    stop(): void;
}

/**
 * The fetch gate. A host the configuration does not name as a forge asks, with its name in the question; a "this session"
 * answer is remembered for that host alone.
 */
export function createFetchGuard(pi: Pick<ExtensionAPI, "events">): FetchGuard {
    const allowed = new Set<string>();
    /** The host of each call this gate asked about, so the answer can be remembered. */
    const asked = new Map<string, string>();
    const unlisten = pi.events.on(DECISION_EVENT, (event: unknown) => {
        const decision = event as {
            toolCallId?: unknown;
            tool?: unknown;
            action?: unknown;
            gate?: unknown;
            answer?: unknown;
        };
        if (decision.tool !== "git" || decision.action !== "fetch" || decision.gate !== FETCH_GATE) return;
        if (typeof decision.toolCallId !== "string") return;
        const host = asked.get(decision.toolCallId);
        asked.delete(decision.toolCallId);
        if (host === undefined) return;
        if (decision.answer === "allow-session") allowed.add(host);
    });

    const gate: Gate = {
        name: FETCH_GATE,
        plugin: "jig-git",
        async check(call, signal): Promise<GateVerdict | undefined> {
            const found = await inspectFetch(call, signal);
            if (!found.fetch) return undefined;
            const settings = gitSettings();
            // Every address is looked at: one remote can hold several, and fetch uses the first while `--get` shows the last.
            const open = found.targets.filter((target) => !isTrustedTarget(target, settings, allowed));
            if (open.length === 0) return undefined;
            const first = open[0] as FetchTarget;
            // The answer is remembered by its call id, so only this host is allowed for the session.
            asked.set(call.toolCallId, first.key);
            if (asked.size > 100) asked.delete(asked.keys().next().value as string);
            return { decision: "ask", reason: `fetch from ${first.shown}? Your SSH key will be offered there.` };
        },
    };
    return {
        gate,
        stop: () => {
            allowed.clear();
            asked.clear();
            unlisten?.();
        },
    };
}

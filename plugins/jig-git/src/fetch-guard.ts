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
import { gitTry, scrub } from "./run.ts";

/** The gate's name, as `/jig` shows it. */
export const FETCH_GATE = "git-fetch-host";

/** jig-core publishes every decision on Pi's event bus under this name (`JIG_EVENTS.decision`). The contract is imported
 *  as types only (the plugin's rules test asks for that), and this is the one value it needs. */
const DECISION_EVENT = "jig:decision";

/** A host read from a remote address: scp-like (`git@host:path`) or a URL. Undefined for a local path, which offers no key. */
export function hostOfRemoteUrl(url: string): string | undefined {
    const text = url.trim();
    const scp = /^[^@/\s]+@([^/:\s]+):/.exec(text);
    if (scp !== null) return (scp[1] as string).toLowerCase();
    const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]*@)?(\[[^\]]+\]|[^/:\s]+)/i.exec(text);
    if (scheme === null) return undefined;
    return (scheme[1] as string).replace(/^\[|\]$/g, "").toLowerCase();
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

/** The remote's address, as the repository's configuration holds it, with any credentials in it removed. `git config`
 *  reads the URL a person set: `insteadOf` is not applied, and the guard refuses a repository that sets it. */
async function remoteUrl(repo: string, remote: string, signal?: AbortSignal): Promise<string | undefined> {
    const out = await gitTry(repo, ["config", "--get", `remote.${remote}.url`], { signal, timeoutMs: 3000 });
    return out === undefined ? undefined : scrub(out.trim());
}

/** What the gate decided a fetch's host is: the answer to `check`, without opening a question. */
export interface FetchCheck {
    /** True when the call is a fetch this gate has something to say about. */
    fetch: boolean;
    /** The host the fetch would reach. A local path reaches no host, so it offers no key and has none. */
    host?: string;
    /** The alias in the address that stands for `host`, which the question names. */
    alias?: string;
}

/** Reads the call's repository and remote. A call the tool would refuse anyway gets no answer from here. */
export async function inspectFetch(
    call: Pick<GateCall, "tool" | "action" | "input">,
    signal?: AbortSignal,
): Promise<FetchCheck> {
    if (call.tool !== "git" || call.action !== "fetch") return { fetch: false };
    const input = call.input as { repo?: unknown; remote?: unknown };
    let remote: string;
    try {
        remote = input.remote === undefined ? "origin" : checkRemote(input.remote);
    } catch {
        return { fetch: true };
    }
    let root: string;
    try {
        root = (await resolveRepo(typeof input.repo === "string" ? input.repo : undefined, signal)).root;
    } catch {
        return { fetch: true };
    }
    const url = await remoteUrl(root, remote, signal);
    const alias = url === undefined ? undefined : hostOfRemoteUrl(url);
    if (alias === undefined) return { fetch: true };
    // An ssh alias stands for the host `ssh -G` names, and the configuration may name either, so both are looked at.
    const real = isSshOrigin(url as string) ? (await originHost(url as string, alias, gitSettings())).real : alias;
    return { fetch: true, alias, host: real };
}

/** Whether a fetch runs without a question: the host, or the alias standing for it, is one the user's configuration names. */
export function isTrustedFetch(
    check: FetchCheck,
    settings: GitSettings,
    allowed: ReadonlySet<string> = new Set(),
): boolean {
    if (check.host === undefined) return true;
    return (
        isTrustedHost(check.host, settings, allowed) ||
        (check.alias !== undefined && isTrustedHost(check.alias, settings, allowed))
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
            if (!found.fetch || found.host === undefined) return undefined;
            if (isTrustedFetch(found, gitSettings(), allowed)) return undefined;
            // The answer is remembered by its call id, so only this host is allowed for the session.
            asked.set(call.toolCallId, found.host);
            if (asked.size > 100) asked.delete(asked.keys().next().value as string);
            return {
                decision: "ask",
                reason: `fetch from ${found.alias ?? found.host}? Your SSH key will be offered there.`,
            };
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

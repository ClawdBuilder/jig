// The real host behind the host in origin's address. An ssh origin often names an alias from `~/.ssh/config`
// (`git@github.com-work:acme/orders-api.git`): git needs the alias to pick the key, but `gh` and `glab` need the host the alias
// stands for, and an alias they are told fails with "error connecting to github.com-work". `githubRepo` and `forgeOf` both ask
// here, so the two cannot disagree about which host a repository is on or which host the forge's command is told.
//
// The real host is, in this order:
// 1. for an ssh origin (scp-like `user@host:path` or `ssh://`), the `hostname` that `ssh -G <host>` prints. `-G` only reads the
//    configuration and never connects. An https origin is not asked: its host is the real one;
// 2. when ssh cannot answer (not installed, it fails, it times out) or has nothing to add, the convention: `github.com-<alias>`
//    and `ssh.github.com` are github.com, and `altssh.gitlab.com` is gitlab.com;
// 3. the host itself.
//
// An entry of `git.forges` decides the forge, and an object-form entry with a `host` decides the host too, over all of this.
import { jig } from "../../jig-core/src/client.ts";
import type { Forge, GitSettings } from "./config.ts";

/** Where `gh` is told to look when origin is on github.com or an ssh alias for it: its own default, so never set. */
export const GITHUB_COM = "github.com";
export const GITLAB_COM = "gitlab.com";

/** The ssh answer is a few lines read from a file, so a slow one is a stuck one. */
const T_SSH_G = 3000;
/** How long "ssh could not tell" is believed before ssh is asked again. An answer is kept for the session. */
const RETRY_MS = 60_000;
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** What was settled about a host of origin. */
export interface OriginHost {
    /** The host in origin's address, in lower case. Git keeps using it. */
    alias: string;
    /** The real host, after ssh's answer and the convention. */
    real: string;
    /** The forge that `git.forges` names for the alias or for the real host. */
    configured?: Forge;
    /** The host `gh` or `glab` is told: an object-form entry's own `host`, else the real host. */
    told: string;
    /** Whether `told` is an object-form entry's `host`. */
    explicit: boolean;
}

/** An ssh origin: scp-like (`user@host:path`) or `ssh://`. An https or git:// address never needs ssh's configuration. */
export function isSshOrigin(url: string): boolean {
    const address = url.trim();
    if (/^ssh:\/\//i.test(address)) return true;
    return !/^[a-z][a-z0-9+.-]*:\/\//i.test(address) && /^[^@/\s]+@[^/:\s]+:/.test(address);
}

/** The convention for a host that ssh could not explain. */
function byConvention(host: string): string {
    if (host.startsWith("github.com-") || host === "ssh.github.com") return GITHUB_COM;
    return host === "altssh.gitlab.com" ? GITLAB_COM : host;
}

// ---- asking ssh -----------------------------------------------------------------------------------------------------

const known = new Map<string, { answer: string | undefined; until: number }>();
const asking = new Map<string, Promise<string | undefined>>();

/** Forgets what ssh said; for tests that change the configuration under it. */
export function forgetSshAnswers(): void {
    known.clear();
    asking.clear();
}

/** `hostname` from `ssh -G <host>`, in lower case, or undefined when ssh could not say. Nothing is ever sent over a network. */
async function askSsh(host: string): Promise<string | undefined> {
    try {
        const result = await jig().exec.run("ssh", ["-G", host], { timeoutMs: T_SSH_G, input: "" });
        if (result.code !== 0 || result.timedOut) return undefined;
        const name = /^hostname[ \t]+(\S+)[ \t]*$/m.exec(result.stdout)?.[1]?.toLowerCase();
        return name !== undefined && HOST.test(name) ? name : undefined;
    } catch {
        return undefined;
    }
}

/** An answer is kept for the session, a failure for a minute, and two calls at once ask once. */
async function sshHostname(host: string): Promise<string | undefined> {
    if (!HOST.test(host)) return undefined;
    const earlier = known.get(host);
    if (earlier !== undefined && earlier.until > Date.now()) return earlier.answer;
    let pending = asking.get(host);
    if (pending === undefined) {
        pending = askSsh(host).then((answer) => {
            known.set(host, { answer, until: answer === undefined ? Date.now() + RETRY_MS : Number.POSITIVE_INFINITY });
            asking.delete(host);
            return answer;
        });
        asking.set(host, pending);
    }
    return pending;
}

// ---- deciding -------------------------------------------------------------------------------------------------------

/**
 * Settles the host of origin's address: its real host, the forge `git.forges` names for it, and the host the forge's command is
 * told. The `git.forges` entry is looked up by the host in the address first, then by the real host, so a self-hosted host named
 * there is found whatever alias reaches it.
 */
export async function originHost(url: string, host: string, settings: GitSettings): Promise<OriginHost> {
    const alias = host.toLowerCase();
    const answered = isSshOrigin(url) ? await sshHostname(alias) : undefined;
    const real = byConvention(answered ?? alias);
    const entry = settings.forges?.[alias] ?? settings.forges?.[real];
    const configured = typeof entry === "string" ? entry : entry?.forge;
    const named = typeof entry === "object" ? entry.host : undefined;
    return {
        alias,
        real,
        ...(configured === undefined ? {} : { configured }),
        told: named ?? real,
        explicit: named !== undefined,
    };
}

/**
 * Every host `git.accounts` may be keyed to for this origin, in the order to try: the host `gh` is told (an explicit forge
 * host or the real host), the GitHub host a clone-host alias stands for, then the real host and the alias as origin wrote it.
 * An alias ssh cannot resolve is therefore still matchable by the host the forge configuration or the clone host names.
 */
export function accountHosts(host: OriginHost, settings: GitSettings): string[] {
    const hosts = [host.told];
    if (host.configured === "github" || isGithubOrigin(host, settings)) hosts.push(githubHostOf(host));
    hosts.push(host.real, host.alias);
    return [...new Set(hosts.map((name) => name.toLowerCase()))];
}

/** Whether a host that no `git.forges` entry names is GitHub: github.com, or the configured clone host (an ssh alias for it). */
export function isGithubOrigin(host: OriginHost, settings: GitSettings): boolean {
    return host.real === GITHUB_COM || host.alias === settings.cloneHost.toLowerCase();
}

/**
 * The host `gh` is told for a GitHub origin that no `git.forges` entry names: the real host, which is github.com for every host
 * that is github.com or an alias for it. A clone host that ssh could not explain is github.com too.
 */
export function githubHostOf(host: OriginHost): string {
    return host.real === host.alias ? GITHUB_COM : host.real;
}

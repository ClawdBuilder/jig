// `deploy status` for pins: per environment, what the branch that deploys pins, for whom, who changed it last and when, the
// open pull requests that would change it, and what the cluster runs when the environment has a runtime.
//
// A pin is read from GitHub, never from the cluster, so this says what the control repository asks for. An environment that
// cannot be read is one line saying why, and the others are still read.
import type { Environment } from "../catalog.ts";
import { verdictLine } from "../runtime/kubernetes/rollout.ts";
import { look } from "../runtime/kubernetes/wait.ts";
import type { Outcome } from "../values.ts";
import type { PinCall } from "./params.ts";
import { branchPattern } from "./pin-config.ts";
import type { PinSource } from "./pin-config.ts";
import { openPullRequests, PULL_PAGE } from "./pin-github.ts";
import type { PullRequest, Reads } from "./pin-github.ts";
import { changeText, readHolder, readPins, runsAs } from "./pin-read.ts";

/** What was read for one environment: the line to show, and the facts that go into the record. */
export interface Pinned {
    text: string;
    version: string;
    ticket: string | undefined;
}

/** The open pull requests into a branch, read once per repository and branch in one call. */
export type PullCache = Map<string, Promise<PullRequest[]>>;

function pullsOf(cache: PullCache, source: PinSource, reads: Reads): Promise<PullRequest[]> {
    const key = JSON.stringify([source.repo, source.base]);
    let found = cache.get(key);
    if (found === undefined) {
        found = openPullRequests(source.repo, source.base, reads);
        cache.set(key, found);
    }
    return found;
}

/**
 * What the branch pins: `main pins 1.4.2 (PROJ-41), changed by A. Person 2026-11-01 10:10 UTC, PR #88`. When the pin files
 * disagree, the text says so and names the files.
 */
export async function readPinned(env: Environment, source: PinSource, reads: Reads): Promise<Pinned> {
    const files = await readPins(source, reads);
    const first = files[0];
    if (first === undefined) throw new Error(`${env.service} in ${env.name} has no pin file`);
    const holder = await readHolder(source, first, reads);
    const ticket = holder.ticket === undefined ? "" : ` (${holder.ticket})`;
    const apart = files.filter((file) => file.version !== first.version);
    const disagree =
        apart.length === 0
            ? ""
            : `; the pin files disagree: ${apart.map((file) => `${file.pin.file} holds ${file.version}`).join(", ")}`;
    return {
        text: `${source.base} pins ${first.version}${ticket}, ${changeText(holder)}${disagree}`,
        version: first.version,
        ticket: holder.ticket,
    };
}

/** The open pull requests that make this environment's pin, by the branch template: `open pin PR #91 "title" by login`. */
async function openPins(
    env: Environment,
    source: PinSource,
    cache: PullCache,
    reads: Reads,
): Promise<string | undefined> {
    if (env.deploy?.method !== "pin") return undefined;
    const pattern = branchPattern(env.deploy.branch, env.service, env.name);
    let pulls: PullRequest[];
    try {
        pulls = await pullsOf(cache, source, reads);
    } catch (error) {
        return `the open pin pull requests could not be read (${error instanceof Error ? error.message : String(error)})`;
    }
    const mine = pulls.filter((pull) => pull.sameRepo && pattern.test(pull.branch));
    const shown = mine
        .slice(0, 3)
        .map((pull) => `#${pull.number} "${pull.title}"${pull.author === "" ? "" : ` by ${pull.author}`}`);
    const more = mine.length > shown.length ? ` and ${mine.length - shown.length} more` : "";
    const cut = pulls.length >= PULL_PAGE ? ` (only the newest ${PULL_PAGE} open pull requests were read)` : "";
    if (shown.length === 0) return cut === "" ? undefined : `no open pin pull request found${cut}`;
    return `open pin ${mine.length === 1 ? "PR" : "PRs"} ${shown.join(", ")}${more}${cut}`;
}

/** What the cluster runs, judged against the version the pin asks for (as the runtime reports it). */
async function runsNow(
    env: Environment,
    source: PinSource,
    version: string,
    reads: Reads,
): Promise<string | undefined> {
    if (env.kubernetes === undefined) return undefined;
    try {
        const { rollout } = await look({ target: env.kubernetes, signal: reads.signal }, runsAs(source, version));
        return verdictLine(rollout, env.kubernetes, runsAs(source, version)).replace(/\.$/, "");
    } catch (error) {
        return `the cluster could not be read (${error instanceof Error ? error.message : String(error)})`;
    }
}

/** One environment's line. A pin that cannot be read says why, in place of the rest. */
async function environmentLine(
    env: Environment,
    source: PinSource,
    cache: PullCache,
    reads: Reads,
): Promise<{ line: string; pinned: Pinned | undefined }> {
    let pinned: Pinned;
    try {
        pinned = await readPinned(env, source, reads);
    } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        return { line: `- ${env.name}: the pin could not be read: ${why}`, pinned: undefined };
    }
    const parts = [pinned.text];
    const open = await openPins(env, source, cache, reads);
    if (open !== undefined) parts.push(open);
    const runs = await runsNow(env, source, pinned.version, reads);
    if (runs !== undefined) parts.push(runs);
    return { line: `- ${env.name}: ${parts.join("; ")}.`, pinned };
}

/** `status`: every named environment's pin, or every environment of the service that has one. */
export async function statusPinAction(call: Extract<PinCall, { action: "status" }>, reads: Reads): Promise<Outcome> {
    const cache: PullCache = new Map();
    const lines: string[] = [call.service];
    const seen: Array<{ environment: string; version: string | null; ticket: string | null }> = [];
    let unreadable = 0;
    // One after the other: the calls come in a fixed order, and GitHub is not asked in parallel.
    for (const env of call.environments) {
        const source = env.deploy?.method === "pin" ? env.deploy : env.pinned;
        if (source === undefined) continue;
        const { line, pinned } = await environmentLine(env, source, cache, reads);
        lines.push(line);
        if (pinned === undefined) unreadable++;
        seen.push({ environment: env.name, version: pinned?.version ?? null, ticket: pinned?.ticket ?? null });
    }
    return {
        text: lines.join("\n"),
        facts: { environments: seen.length, unreadable },
        details: { environments: seen },
    };
}

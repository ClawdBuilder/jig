// `deploy plan` for a pin: what a run would change, worked out from reads only. The same plan is what `deploy run` will show
// and fingerprint once it writes: the file and its line as they are on the branch that deploys, who holds the environment, the
// branch the change would be made on and the pull request, with the tips they have now.
//
// Nothing is written here. A pin that cannot be planned says why: a file that has no single matching line, a new line the
// pin's own pattern would not read back, or a branch that is not there.
import type { EnvironmentKind } from "../../../jig-core/src/contract.ts";
import type { Environment } from "../catalog.ts";
import { clean, digest, oneLine } from "../values.ts";
import type { Outcome } from "../values.ts";
import type { PinPlanCall } from "./params.ts";
import { fill, isRefName } from "./pin-config.ts";
import type { PinDeploy } from "./pin-config.ts";
import { branchTip, openPullRequests } from "./pin-github.ts";
import type { PullRequest, Reads } from "./pin-github.ts";
import { changeText, lineShown, readHolder, readPins } from "./pin-read.ts";
import type { Holder, PinRead } from "./pin-read.ts";
import { readPinned } from "./pin-status.ts";
import { environmentText, refusal } from "./plan.ts";

/** One file of a pin and the line a run would write. */
export interface PinChange {
    read: PinRead;
    newLine: string;
}

/** What a run of a pin would do. `body` is the review screen; `fingerprint` changes when anything it shows changes. */
export interface PinPlan {
    env: Environment;
    deploy: PinDeploy;
    version: string;
    ticket: string | undefined;
    changes: readonly PinChange[];
    /** True when every pin file already holds the line a run would write. */
    same: boolean;
    holder: Holder;
    branch: string;
    title: string;
    /** The commit the branch that deploys points at, and the tip of the pin branch (undefined while it does not exist). */
    baseTip: string | undefined;
    branchTip: string | undefined;
    /** The open pull request from the pin branch, when there is one. */
    pull: PullRequest | undefined;
    body: string;
    fingerprint: string;
}

const short = (sha: string | undefined): string => (sha === undefined ? "none" : sha.slice(0, 7));

/** The new line for one file: the pin's `write` with the call's values, else the line's own, filled in. */
function newLineOf(call: PinPlanCall, deploy: PinDeploy, read: PinRead): string {
    const write = deploy.pins.find((pin) => pin.file === read.pin.file)?.write ?? "";
    const kept: Record<string, string> = { ...read.groups };
    const line = fill(write, {
        ...kept,
        ...call.values,
        version: call.version,
        service: call.env.service,
        environment: call.env.name,
        ...(call.ticket === undefined ? {} : { ticket: call.ticket }),
    });
    if (/[\u0000-\u001f\u007f]/.test(line)) {
        throw new Error(`the new line for ${read.pin.file} would hold a control character`);
    }
    const back = read.pin.line.regex.exec(line);
    if (back === null || back.groups?.version !== call.version) {
        throw new Error(
            `the new line for ${read.pin.file} would not be read back by the pin's own pattern, ` +
                'so the pin could not be checked afterwards: fix "line" or "write" in the ops catalog of jig.json',
        );
    }
    return line;
}

function holderText(plan: Pick<PinPlan, "env" | "holder" | "ticket">, current: PinRead): string {
    const { env, holder, ticket } = plan;
    const who = holder.ticket === undefined ? `pinned to ${current.version}` : `pinned for ${holder.ticket}`;
    const detail = holder.ticket === undefined ? changeText(holder) : `${current.version}, ${changeText(holder)}`;
    const next =
        ticket === undefined
            ? "this replaces it."
            : holder.ticket === ticket
              ? `this changes the pin of the same ticket, ${ticket}.`
              : `this replaces it with ${ticket}.`;
    return `${env.name} is ${who} (${detail}); ${next}`;
}

function nextText(deploy: PinDeploy, env: Environment): string {
    const merged =
        deploy.merge === "tool" ? "it is merged with deploy merge, which asks each time" : "a person merges it";
    const applied =
        deploy.apply === "job" ? `then the ${env.name} job applies it` : "then the platform applies it by itself";
    return `${merged}; ${applied}.`;
}

/** Reads the files, the holder, the branch tips and the open pull requests, and works out what a run would write. */
export async function planPin(call: PinPlanCall, kind: EnvironmentKind, reads: Reads): Promise<PinPlan> {
    const { env, deploy, version, ticket } = call;
    if (deploy === undefined) throw new Error(`${env.service} in ${env.name} has no pin deploy`);
    const files = await readPins(deploy, reads);
    const changes = files.map((read) => ({ read, newLine: newLineOf(call, deploy, read) }));
    const first = changes[0] as PinChange;
    const same = changes.every((change) => change.read.raw === change.newLine);
    const holder = await readHolder(deploy, first.read, reads);

    const names = { version, service: env.service, environment: env.name, ...(ticket === undefined ? {} : { ticket }) };
    const branch = fill(deploy.branch, names);
    const title = oneLine(clean(fill(deploy.title, names)), 200);
    if (!isRefName(branch)) throw new Error(`the branch name ${branch.slice(0, 60)} is not one a pin can use`);

    const planned = { env, deploy, version, ticket, changes, same, holder, branch, title };
    const base = await branchTip(deploy.repo, deploy.base, reads);
    if (base === undefined) throw new Error(`the branch ${deploy.base} was not found in ${deploy.repo}`);
    if (same) {
        const body = `${env.name} is already pinned to ${version} (${first.read.pin.file}): there is nothing to change.`;
        return {
            ...planned,
            baseTip: base,
            branchTip: undefined,
            pull: undefined,
            body,
            fingerprint: digest(
                "deploy pin",
                env.service,
                env.name,
                changes.map((c) => c.read.blob),
                base,
            ),
        };
    }
    const tip = await branchTip(deploy.repo, branch, reads);
    const pulls = await openPullRequests(deploy.repo, deploy.base, reads);
    const pull = pulls.find((entry) => entry.branch === branch && entry.sameRepo);

    const row = (label: string, value: string): string => `${label}:`.padEnd(15) + value;
    const branchText =
        tip === undefined
            ? `${branch} (new, from ${deploy.base} at ${short(base)})`
            : `${branch} (exists at ${short(tip)}; it would be moved to ${deploy.base} at ${short(base)})`;
    const body = [
        row("Service", env.service),
        row("Environment", environmentText(env.name, kind)),
        row("Method", `pin, in ${deploy.repo} on ${deploy.base}`),
        row("Holder", holderText({ env, holder, ticket }, first.read)),
        ...changes.flatMap((change) => [
            row("File", `${change.read.pin.file} (line ${change.read.lineNumber})`),
            row("Line", `${change.read.line} -> ${lineShown(change.newLine)}`),
        ]),
        row("Branch", branchText),
        row("Pull request", pull === undefined ? `${title} (new)` : `${title} (edits the open #${pull.number})`),
        row("Next", nextText(deploy, env)),
    ].join("\n");
    const fingerprint = digest(
        "deploy pin",
        env.service,
        env.name,
        deploy.repo,
        deploy.base,
        changes.map((change) => [change.read.pin.file, change.read.blob, change.newLine]),
        base,
        tip ?? null,
        pull === undefined ? null : [pull.number, pull.title, pull.sha],
        holder.commit?.sha ?? null,
        branch,
        title,
    );
    return { ...planned, baseTip: base, branchTip: tip, pull, body, fingerprint };
}

const NOT_BUILT = "This is a plan: nothing was written. deploy run for a pin is not available yet.";

/** `plan`: what a run would change, or why a run would be refused, and in both cases what the branch pins now. */
export async function planPinAction(call: PinPlanCall, kind: EnvironmentKind, reads: Reads): Promise<Outcome> {
    const { env } = call;
    const head = `Deploy plan for ${env.service} in ${environmentText(env.name, kind)}:`;
    const why = refusal("run", env, kind);
    if (why !== undefined) {
        const source = call.source;
        let now: string;
        try {
            now = (await readPinned(env, source, reads)).text;
        } catch (error) {
            now = `the pin could not be read: ${error instanceof Error ? error.message : String(error)}`;
        }
        return {
            text: [head, `A deploy run would be refused: ${why}.`, `Pinned now: ${now}.`].join("\n"),
            facts: { refused: true, method: "pin" },
            details: { refused: true, method: "pin" },
        };
    }
    const plan = await planPin(call, kind, reads);
    return {
        text: [head, plan.body, "", NOT_BUILT].join("\n"),
        facts: { method: "pin", same: plan.same },
        details: { method: "pin", requested: plan.version, same: plan.same, fingerprint: plan.fingerprint },
    };
}

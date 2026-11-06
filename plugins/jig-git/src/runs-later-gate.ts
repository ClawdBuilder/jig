// A git operation that changes the working tree can write a file that runs later outside the sandbox: .pi/settings.json,
// a shell file, .git/config, a hook. The gate resolves the real repository and the real refs, then asks before such an
// operation. It reads the same table as the sandbox and the file tools.
import type { Gate, GateCall, GateVerdict } from "../../jig-core/src/contract.ts";
import { gitSettings } from "./config.ts";
import { guardedChanges, guardedStashChanges, guardedTargets } from "./guarded.ts";
import { resolveRepo } from "./repo.ts";

export const RUNS_LATER_GATE = "git-guarded-paths";

/** The actions that can change the working tree. */
export const CHANGING: ReadonlySet<string> = new Set(["branch", "merge", "sync", "rebase", "cherry_pick", "stash"]);

export const runsLaterGate: Gate = {
    name: RUNS_LATER_GATE,
    plugin: "jig-git",
    async check(call: GateCall, signal: AbortSignal): Promise<GateVerdict | undefined> {
        if (call.tool !== "git" || call.action === undefined || !CHANGING.has(call.action)) return undefined;
        const operation = typeof call.input.operation === "string" ? call.input.operation : undefined;
        if (call.action === "stash" && operation !== "pop" && operation !== "apply") return undefined;
        if (call.action === "branch" && operation !== "switch" && operation !== "create") return undefined;
        const repo = await resolveRepo(typeof call.input.repo === "string" ? call.input.repo : undefined, signal);
        const target = await guardedTargets(call.action, call.input, repo.root, gitSettings(), signal);
        if (target === undefined) return undefined;
        const paths = new Set<string>();
        for (const one of target.targets) {
            const found =
                call.action === "stash"
                    ? await guardedStashChanges(repo.root, one.sha, signal)
                    : await guardedChanges(repo.root, target.from, one.sha, signal);
            for (const path of found) paths.add(path);
        }
        if (paths.size === 0) return undefined;
        return {
            decision: "ask",
            reason: `this operation would change ${paths.size} file${paths.size === 1 ? "" : "s"} that run later outside the sandbox: ${[...paths].slice(0, 5).join(", ")}${paths.size > 5 ? ", …" : ""}`,
        };
    },
};

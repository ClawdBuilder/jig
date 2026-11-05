// A git operation that changes the working tree can write a file that runs later outside the sandbox: .pi/settings.json,
// a shell file, .git/config, a hook. The sandbox does not stand between the git tool and the working tree, so this gate
// asks before such an operation. It reads the same table as the sandbox and the file tools.
import type { Gate, GateCall, GateVerdict } from "../../jig-core/src/contract.ts";
import { isRepositoryRunsLater } from "../../jig-core/src/kit/runs-later.ts";
import { PI_PROJECT_PATHS } from "../../jig-core/src/kit/pi-project-paths.ts";
import { git } from "./run.ts";

export const RUNS_LATER_GATE = "git-guarded-paths";

const CHANGING = new Set(["branch", "merge", "sync", "rebase", "cherry_pick", "stash", "restore", "worktree", "clone"]);

function guarded(relative: string): boolean {
    const path = relative.split("\\").join("/");
    if (path === ".git/config" || path.startsWith(".git/hooks/")) return true;
    for (const item of PI_PROJECT_PATHS) if (path === item || path.startsWith(`${item}/`)) return true;
    return isRepositoryRunsLater(path);
}

/** The commits a changing operation would bring in, as pairs of (from, to) to difference. */
async function pairs(call: GateCall): Promise<Array<[string, string]> | undefined> {
    const repo = call.cwd;
    const operation = typeof call.input.operation === "string" ? call.input.operation : undefined;
    const base = (text: unknown): string | undefined => (typeof text === "string" && text !== "" ? text : undefined);
    const target = async (): Promise<string | undefined> => {
        if (call.action === "branch" && operation === "switch") return base(call.input.branch);
        if (call.action === "merge") return base(call.input.branch) ?? "FETCH_HEAD";
        if (call.action === "sync" || call.action === "rebase") return "FETCH_HEAD";
        return undefined;
    };
    if (call.action === "stash" && (operation === "pop" || operation === "apply"))
        return [["stash@{0}", "stash@{0}^1"]];
    if (call.action === "cherry_pick") {
        const revs = Array.isArray(call.input.revs)
            ? call.input.revs.filter((rev): rev is string => typeof rev === "string")
            : [];
        if (revs.length === 0) return undefined;
        return revs.map((rev) => ["HEAD", rev]);
    }
    const to = await target();
    if (to === undefined) return undefined;
    const head = await git(repo, ["rev-parse", "--verify", `${to}^{commit}`]);
    if (head.code !== 0) return undefined;
    return [["HEAD", head.stdout.trim()]];
}

async function changedGuarded(call: GateCall): Promise<string[] | "unknown"> {
    const ranges = await pairs(call);
    if (ranges === undefined) return "unknown";
    const names = new Set<string>();
    for (const [from, to] of ranges) {
        const out = await git(call.cwd, ["diff", "--name-only", "-z", from, to]);
        if (out.code !== 0) return "unknown";
        for (const name of out.stdout.split("\u0000")) if (name !== "") names.add(name);
    }
    return [...names].filter((name) => guarded(name));
}

export const runsLaterGate: Gate = {
    name: RUNS_LATER_GATE,
    plugin: "jig-git",
    async check(call: GateCall): Promise<GateVerdict | undefined> {
        if (call.tool !== "git" || call.action === undefined || !CHANGING.has(call.action)) return undefined;
        const operation = typeof call.input.operation === "string" ? call.input.operation : undefined;
        if (call.action === "stash" && operation !== "pop" && operation !== "apply") return undefined;
        if (call.action === "worktree" && operation !== "add") return undefined;
        if (call.action === "branch" && operation !== "switch") return undefined;
        if (call.action === "restore")
            return {
                decision: "ask",
                reason: "restore can change guarded files; ask the person before discarding them",
            };
        if (call.action === "clone")
            return { decision: "ask", reason: "a clone writes a working tree; ask the person before it runs" };
        const paths = await changedGuarded(call);
        if (paths === "unknown")
            return {
                decision: "ask",
                reason: "this operation changes the working tree, and the guarded paths it would change could not be read; ask the person",
            };
        if (paths.length === 0) return undefined;
        const shown = paths.slice(0, 5).join(", ");
        return {
            decision: "ask",
            reason: `this operation would change ${paths.length} guarded path${paths.length === 1 ? "" : "s"} that run later outside the sandbox: ${shown}${paths.length > 5 ? ", …" : ""}`,
        };
    },
};

// The `git` tool: the local repository, and the remote write that goes with it (push).
import { stringEnum } from "../../jig-core/src/kit/schema.ts";
import { Type } from "typebox";
import type { CallClass } from "../../jig-core/src/contract.ts";
import { planClone } from "./clone.ts";
import { planBlame, planBranches, planDiff, planLog, planShow, planStatus } from "./git-read.ts";
import { planBranch, planWorktree } from "./git-branch.ts";
import { planCommit, planRestore, planStash } from "./git-changes.ts";
import { planCherryPick, planMerge, planRebase, planSync } from "./git-integrate.ts";
import { planFetch, planPush } from "./git-remote.ts";
import { describeActions } from "./params.ts";
import type { ActionTable } from "./params.ts";
import type { Call, Planned } from "./previews.ts";
import { at, buildTool } from "./tool.ts";
import type { JigTool } from "./tool.ts";

/** What each action takes. The checker, the action list the model reads and the classification all follow this table. */
export const GIT_ACTIONS = {
    status: { summary: "branch, upstream, changes; every repo when none is named", optional: ["repo"] },
    diff: {
        summary: "working tree, staged, a range or against the base",
        optional: ["repo", "against", "base", "range", "format", "paths"],
    },
    log: {
        summary: "commits, filtered by range, paths, author, date or message",
        optional: ["repo", "range", "paths", "author", "since", "until", "grep", "pickaxe", "n", "format"],
    },
    show: { summary: "a commit, or a file at a revision", optional: ["repo", "rev", "path", "format"] },
    blame: { summary: "who last changed each line", required: ["path"], optional: ["repo", "rev", "lines"] },
    branches: { summary: "branches and tracking; which contain a commit", optional: ["repo", "contains", "remotes"] },
    fetch: { summary: "branches and tags from the remote", optional: ["repo", "remote"] },
    clone: { summary: "owner/name into a new folder, over ssh", required: ["repo"], optional: ["dir", "branch"] },
    branch: {
        summary: "create from the fetched base, switch, or delete a merged branch",
        required: ["operation", "branch"],
        optional: ["repo", "base"],
    },
    worktree: {
        summary: "list, add or remove work trees",
        required: ["operation"],
        optional: ["repo", "dir", "branch", "base"],
    },
    commit: {
        summary: "exact paths and a message; amend only while unpushed, alone it rewords",
        required: ["message"],
        optional: ["repo", "paths", "amend"],
    },
    stash: {
        summary: "push, list, pop or drop",
        required: ["operation"],
        optional: ["repo", "message", "paths", "untracked", "index"],
    },
    sync: { summary: "fast-forward from the upstream", optional: ["repo"] },
    merge: { summary: "merge the base or another branch; a conflict aborts", optional: ["repo", "branch", "base"] },
    rebase: { summary: "rebase onto the fetched base; a conflict aborts", optional: ["repo", "base"] },
    cherry_pick: { summary: "apply commits; a conflict aborts", required: ["revs"], optional: ["repo"] },
    restore: { summary: "discard uncommitted changes in paths (asks)", required: ["paths"], optional: ["repo"] },
    push: { summary: "push a branch (asks)", optional: ["repo", "branch", "remote", "force_with_lease"] },
} satisfies ActionTable;

const ACTION_NAMES = Object.keys(GIT_ACTIONS) as (keyof typeof GIT_ACTIONS)[];

const string = (description: string) => Type.Optional(Type.String({ minLength: 1, maxLength: 1000, description }));
const strings = (description: string) =>
    Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 100, description }));
const flag = (description: string) => Type.Optional(Type.Boolean({ description }));

const GitParams = Type.Object(
    {
        action: stringEnum(ACTION_NAMES, { description: describeActions(GIT_ACTIONS) }),
        repo: string("Folder/absolute path; default repo. clone: owner/name."),
        operation: Type.Optional(
            stringEnum(["create", "switch", "delete", "list", "add", "remove", "push", "pop", "drop"] as const, {
                description: "branch: create/switch/delete; worktree: list/add/remove; stash: push/list/pop/drop.",
            }),
        ),
        branch: string("branch: name; clone: checkout; merge: source; push: current."),
        base: string("Base; default git.base or default branch."),
        remote: string("Remote; default origin."),
        paths: strings("Repo paths: commit/restore/stash exact; diff/log filter."),
        path: string("One repo-relative file."),
        rev: string("Revision (HEAD~2, origin/main); default HEAD."),
        revs: strings("cherry_pick: commits, oldest first."),
        range: string("Range a..b."),
        against: Type.Optional(
            stringEnum(["working", "staged", "base"] as const, {
                description: "diff: working (default), staged, merge base.",
            }),
        ),
        format: Type.Optional(
            stringEnum(["summary", "names", "patch", "oneline", "full"] as const, {
                description: "diff/show: summary (default), names, patch; log: oneline (default), full.",
            }),
        ),
        n: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "log: count, default 20." })),
        author: string("log: author."),
        since: string("log: since."),
        until: string("log: until."),
        grep: string("log: message."),
        pickaxe: string("log: diff contains text (-S)."),
        lines: string('blame: "10,20".'),
        contains: string("branches: contain commit."),
        remotes: flag("branches: include remotes."),
        message: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000, description: "Commit/stash message." })),
        amend: flag("commit: replace last unpushed; message only if no paths."),
        force_with_lease: flag("push: force if remote unmoved."),
        dir: string("clone/worktree: folder."),
        index: Type.Optional(
            Type.Integer({ minimum: 0, maximum: 99, description: "stash pop/drop index; default 0." }),
        ),
        untracked: flag("stash push: untracked too."),
    },
    { additionalProperties: false },
);

/** Where each action acts. The action alone decides, except for the operation of `worktree`, whose `list` only reads. */
function classifyGit(input: Readonly<Record<string, unknown>>): CallClass | undefined {
    const action = input.action;
    switch (action) {
        case "status":
        case "diff":
        case "log":
        case "show":
        case "blame":
        case "branches":
            return at(action, "local", "read");
        // It reads GitHub, but it changes only the remote-tracking refs, never the work tree: the README calls it a read.
        case "fetch":
            return at(action, "local", "read");
        case "worktree":
            return at(action, "local", input.operation === "list" ? "read" : "write");
        case "clone":
        case "branch":
        case "commit":
        case "stash":
        case "sync":
        case "merge":
        case "rebase":
        case "cherry_pick":
            return at(action, "local", "write");
        // It destroys uncommitted work, so it asks until a rule says otherwise.
        case "restore":
            return at(action, "local", "write", { atLeast: "ask" });
        case "push":
            return at(action, "external", "write");
        default:
            return undefined;
    }
}

function planGit(params: Readonly<Record<string, unknown>>, call: Call): Promise<Planned> | Planned {
    const p = params as never;
    switch (params.action) {
        case "status":
            return planStatus(p, call);
        case "diff":
            return planDiff(p, call);
        case "log":
            return planLog(p, call);
        case "show":
            return planShow(p, call);
        case "blame":
            return planBlame(p, call);
        case "branches":
            return planBranches(p, call);
        case "fetch":
            return planFetch(p, call);
        case "clone":
            return planClone(p, call);
        case "branch":
            return planBranch(p, call);
        case "worktree":
            return planWorktree(p, call);
        case "commit":
            return planCommit(p, call);
        case "stash":
            return planStash(p, call);
        case "sync":
            return planSync(p, call);
        case "merge":
            return planMerge(p, call);
        case "rebase":
            return planRebase(p, call);
        case "cherry_pick":
            return planCherryPick(p, call);
        case "restore":
            return planRestore(p, call);
        case "push":
            return planPush(p, call);
        default:
            throw new Error(`git: unknown action ${String(params.action)}`);
    }
}

export const gitTool: JigTool = buildTool({
    name: "git",
    label: "Git",
    description:
        "Local git and worktrees: status, diff, log, commit, branch, push. Push and restore ask the user first. Read the git skill before your first git call.",
    promptSnippet: "Local git: status, diff, log, show, blame, branches, commit, branch, push",
    parameters: GitParams,
    table: GIT_ACTIONS,
    classify: classifyGit,
    plan: async (params, call) => planGit(params, call),
});

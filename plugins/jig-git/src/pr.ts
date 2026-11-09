// The `pr` tool: pull requests and reviews on GitHub, through gh, and merge requests on GitLab, through glab. The repository's
// origin decides which, never the call. Reads are allowed. Every write asks the user first, and the text of a write is shown on
// the review screen before it is sent.
import { stringEnum } from "../../jig-core/src/kit/schema.ts";
import { Type } from "typebox";
import type { CallClass } from "../../jig-core/src/contract.ts";
import { describeActions } from "./params.ts";
import type { ActionTable } from "./params.ts";
import {
    planComment,
    planCreate,
    planEdit,
    planMerge,
    planReady,
    planReply,
    planResolve,
    planReview,
} from "./pr-write.ts";
import { planComments, planList, planView } from "./pr-read.ts";
import { homeOf, planGitlabPr } from "./gitlab-pr.ts";
import { planWatch } from "./pr-watch-tool.ts";
import type { Call, Planned } from "./previews.ts";
import { at, buildTool } from "./tool.ts";
import type { JigTool } from "./tool.ts";

export const PR_ACTIONS = {
    view: { summary: "state, review, checks and body", optional: ["repo", "number", "branch"] },
    list: {
        summary: "pull requests by state, author or branch",
        optional: ["repo", "state", "author", "branch", "limit"],
    },
    comments: {
        summary: "conversation, reviews and line comments, with thread ids",
        optional: ["repo", "number", "branch", "author", "unresolved"],
    },
    create: {
        summary: "open one from a pushed branch; returns the open one if there is one",
        required: ["title"],
        optional: ["repo", "body", "branch", "base", "draft"],
    },
    edit: {
        summary: "title, body, base, labels, reviewers",
        required: ["number"],
        optional: ["repo", "title", "body", "base", "labels", "reviewers"],
    },
    ready: { summary: "draft to ready for review", required: ["number"], optional: ["repo"] },
    comment: { summary: "a comment on the conversation", required: ["number", "body"], optional: ["repo"] },
    reply: { summary: "a reply in a review thread", required: ["thread", "body"], optional: ["repo"] },
    resolve: { summary: "resolve a review thread", required: ["thread"], optional: ["repo"] },
    review: {
        summary: "comment or request changes; never approves",
        required: ["number", "event", "body"],
        optional: ["repo"],
    },
    merge: {
        summary: "merge, squash or rebase at the head you saw; or auto-merge",
        required: ["number", "method"],
        optional: ["repo", "auto"],
    },
    watch: {
        summary: "tell me about new comments on a pull request, in the background",
        optional: ["repo", "number", "branch"],
    },
} satisfies ActionTable;

const ACTION_NAMES = Object.keys(PR_ACTIONS) as (keyof typeof PR_ACTIONS)[];

const PrParams = Type.Object(
    {
        action: stringEnum(ACTION_NAMES, { description: describeActions(PR_ACTIONS) }),
        repo: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 1000,
                description: "Folder/path, not owner/name; default repo.",
            }),
        ),
        number: Type.Optional(Type.Integer({ minimum: 1, description: "Pull/merge request number." })),
        branch: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 200,
                description: "Head branch; default current.",
            }),
        ),
        base: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 200,
                description: "Base; default git.base or default branch.",
            }),
        ),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 256, description: "One line." })),
        body: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 60_000,
                description: "Markdown; create omit template; edit replaces.",
            }),
        ),
        draft: Type.Optional(Type.Boolean({ description: "create: open it as a draft." })),
        method: Type.Optional(stringEnum(["merge", "squash", "rebase"] as const, { description: "How to merge." })),
        auto: Type.Optional(Type.Boolean({ description: "merge: turn on auto-merge instead of merging now." })),
        event: Type.Optional(
            stringEnum(["comment", "request_changes"] as const, {
                description: "review: comment/request changes; a person approves.",
            }),
        ),
        thread: Type.Optional(
            Type.String({ minLength: 8, maxLength: 200, description: "Thread id from pr comments." }),
        ),
        author: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 100,
                description: "list/ comments: author or @me.",
            }),
        ),
        unresolved: Type.Optional(Type.Boolean({ description: "comments: unresolved only." })),
        state: Type.Optional(
            stringEnum(["open", "closed", "merged", "all"] as const, {
                description: "list: state; default open.",
            }),
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "list: count, default 20." })),
        labels: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
                maxItems: 30,
                description: "edit: labels to add.",
            }),
        ),
        reviewers: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
                maxItems: 30,
                description: "edit: reviewers. GitLab: usernames.",
            }),
        ),
    },
    { additionalProperties: false },
);

/** Reads are external reads. Every write is an external write; text that people read is shown on the review screen. */
function classifyPr(input: Readonly<Record<string, unknown>>): CallClass | undefined {
    const action = input.action;
    switch (action) {
        case "view":
        case "list":
        case "comments":
            return at(action, "external", "read");
        case "create":
        case "edit":
        case "comment":
        case "reply":
        case "review":
            return at(action, "external", "write", { approval: "review" });
        case "ready":
        case "resolve":
        case "merge":
            return at(action, "external", "write");
        // Starts a poll that only reads GitHub, as the ci tool's watch does: a local write, so it does not ask.
        case "watch":
            return at(action, "local", "write");
        default:
            return undefined;
    }
}

async function planPr(params: Readonly<Record<string, unknown>>, call: Call): Promise<Planned> {
    const home = await homeOf(params, call);
    return home.forge === "gitlab" ? planGitlabPr(params, call, home) : planGithubPr(params, call);
}

function planGithubPr(params: Readonly<Record<string, unknown>>, call: Call): Promise<Planned> | Planned {
    const p = params as never;
    switch (params.action) {
        case "view":
            return planView(p, call);
        case "list":
            return planList(p, call);
        case "comments":
            return planComments(p, call);
        case "create":
            return planCreate(p, call);
        case "edit":
            return planEdit(p, call);
        case "ready":
            return planReady(p, call);
        case "comment":
            return planComment(p, call);
        case "reply":
            return planReply(p, call);
        case "resolve":
            return planResolve(p, call);
        case "review":
            return planReview(p, call);
        case "merge":
            return planMerge(p, call);
        case "watch":
            return planWatch(p, call);
        default:
            throw new Error(`pr: unknown action ${String(params.action)}`);
    }
}

export const prTool: JigTool = buildTool({
    name: "pr",
    label: "Pull request",
    description:
        "Pull and merge requests by the repository's origin: view, comments, create, review, merge. Every write asks the user first. Read the git skill before your first pr call.",
    promptSnippet: "Pull and merge requests: view, comments, watch, create, review, merge",
    promptGuidelines: [
        "Use the pr tool for pull requests and merge requests, not bash: the shell has no GitHub or GitLab sign-in. Push the branch with the git tool first.",
    ],
    parameters: PrParams,
    table: PR_ACTIONS,
    classify: classifyPr,
    plan: async (params, call) => planPr(params, call),
});

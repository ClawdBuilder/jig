// The audit: what a plugin promises about its actions, checked from its own code rather than by reading it.
//
//  1. What its documentation says. Every action a tool offers is a row of a table in the plugin's README or its docs, and
//     the row's effect and approval are the ones `classify` returns. A write that turns into a read, or a dialog that turns
//     into a review screen, is a documentation change and a code change in one commit, or this fails.
//  2. What `classify` decides. The environment, effect and approval of every action are recorded in TABLE below. A change
//     there shows in a diff, so an action cannot quietly change side.
//  3. What its tests name. The report counts the actions no test in the plugin names, so an untested action is seen rather
//     than assumed. It is a report: an action can be covered by a shared fixture.
//
// A tool without an `action` parameter (bash, the file tools, a single-purpose tool) is skipped: it has no action to audit.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionFactory, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { jig, withdrawJig } from "../src/client.ts";
import type { CallClass, ToolDeclaration } from "../src/contract.ts";
import type { JigApi } from "../src/contract.ts";
import { jigCore } from "../src/index.ts";
import { fakePi } from "./support/fake-pi.ts";
import { tempState } from "./support/state.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const state = tempState();
let published: JigApi | undefined;
beforeEach(() => state.start());
afterEach(() => {
    if (published !== undefined) withdrawJig(published);
    published = undefined;
    state.stop();
});

/** One tool, as its plugin declared it, with everything its plugin documents. */
interface Audited {
    plugin: string;
    tool: string;
    actions: string[];
    declaration: ToolDeclaration;
    docs: string;
}

/** The plugins in the order package.json loads them: jig-core first, then each other plugin, by its entry file. */
function extensions(): Array<{ plugin: string; file: string }> {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
        pi: { extensions: string[] };
    };
    return manifest.pi.extensions.map((entry) => ({
        plugin: /^\.\/plugins\/([^/]+)\//.exec(entry)?.[1] ?? entry,
        file: path.join(ROOT, entry),
    }));
}

/** A plugin's README and every page under its docs, joined: its tables may be on either. */
function documented(plugin: string): string {
    const folder = path.join(ROOT, "plugins", plugin);
    const pages = [path.join(folder, "README.md")];
    const walk = (dir: string): void => {
        let names: string[];
        try {
            names = readdirSync(dir);
        } catch {
            return;
        }
        for (const name of names) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith(".md")) pages.push(full);
        }
    };
    walk(path.join(folder, "docs"));
    return pages.map((page) => readFileSync(page, "utf8")).join("\n");
}

/** Every plugin loaded into one stand-in for Pi, with the tools and declarations it registered. */
async function audit(): Promise<Audited[]> {
    const host = fakePi();
    await jigCore()(host.pi);
    published = jig();
    const api = published;
    const declared: ToolDeclaration[] = [];
    const declare = api.declareTool.bind(api);
    (api as { declareTool: typeof declare }).declareTool = (declaration) => {
        declared.push(declaration);
        declare(declaration);
    };
    for (const { file } of extensions().slice(1)) {
        const module = (await import(file)) as { default: ExtensionFactory };
        await module.default(host.pi);
    }
    const audited: Audited[] = [];
    for (const declaration of declared) {
        const tool: ToolDefinition | undefined = host.registered.get(declaration.tool);
        if (tool === undefined) continue;
        const action = (tool.parameters as { properties?: Record<string, { enum?: string[] }> }).properties?.action;
        audited.push({
            plugin: declaration.plugin,
            tool: declaration.tool,
            actions: [...(action?.enum ?? [])],
            declaration,
            docs: documented(declaration.plugin),
        });
    }
    return audited;
}

/** The rows of every Markdown table in a page, each row as its cells. */
function tables(markdown: string): string[][] {
    return markdown
        .split("\n")
        .filter((line) => line.startsWith("|") && !line.startsWith("|---"))
        .map((line) =>
            line
                .split("|")
                .slice(1, -1)
                .map((cell) => cell.trim()),
        );
}

/** The names a cell lists, such as "`rebase`, `cherry_pick`": its backticked words. */
function namesOf(cell: string): string[] {
    return [...cell.matchAll(/`([a-z][a-z_-]*)`/g)].map((match) => match[1] ?? "");
}

/** The effect a cell names, when it names one: "read", "local write", "external write, asks", "read, or write". */
const EFFECT = /^(?:a |the )?(?:local |external )?(?:read|write)\b|^depends\b|^the strictest\b|^read, or write\b/i;

/** The effect cell of a row, which follows the cell naming the actions. */
function effectOf(cells: string[]): string | undefined {
    return cells.find((cell) => EFFECT.test(cell));
}

/**
 * The documentation row of every action of a tool, from every table in its README and docs. A row may name several actions
 * ("`tags`, `releases`"), its group cell may be empty on a continuation row, and its effect may be the second cell or the
 * third. A row that names an effect wins over one that does not, such as a table of the HTTP calls an action makes.
 */
function actionRows(markdown: string, actions: readonly string[]): Map<string, string | undefined> {
    const rows = new Map<string, string | undefined>();
    for (const cells of tables(markdown)) {
        const at = cells.findIndex((candidate) => namesOf(candidate).some((name) => actions.includes(name)));
        if (at === -1) continue;
        const effect = effectOf(cells.slice(at + 1));
        for (const name of namesOf(cells[at] ?? "")) {
            if (!actions.includes(name)) continue;
            if (rows.get(name) === undefined || effect !== undefined) rows.set(name, effect);
        }
    }
    return rows;
}

/** The text of every file under a plugin's tests. */
function testText(plugin: string): string {
    const found: string[] = [];
    const walk = (dir: string): void => {
        let names: string[];
        try {
            names = readdirSync(dir);
        } catch {
            return;
        }
        for (const name of names) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith(".ts")) found.push(readFileSync(full, "utf8"));
        }
    };
    walk(path.join(ROOT, "plugins", plugin, "test"));
    return found.join("\n");
}

/** A call's input for one action: the action, and the fields its classify needs to get past the first check. */
const INPUTS: Record<string, Record<string, unknown>> = {
    mongo: {
        environment: "local",
        database: "orders",
        collection: "orders",
        field: "status",
        filter: {},
        projection: {},
        sort: {},
        pipeline: [],
        documents: [],
        operations: [],
        keys: { status: 1 },
        name: "status_1",
        replacement: {},
        update: {},
        which: "one",
    },
    api: {
        request: "health",
        environment: "local",
        method: "GET",
        url: "https://api.example.com/health",
        folder: "orders",
    },
    subagent: { role: "scout", task: "look at the build", child: "scout-1", text: "hello" },
    ticket: { text: "done", label: "logs", id: "1", outcome: "passed" },
    workflow: { repo: "orders-api", number: 1, result: "passed" },
};

/** The exact input one action takes, where a tool rejects a field its action does not use. */
const ACTION_INPUTS: Record<string, Record<string, unknown>> = {
    "ticket save-evidence": { text: "a log line", label: "logs" },
    "ticket add-check": { text: "does the page load" },
    "ticket list-checks": {},
    "ticket close-check": { id: "1", outcome: "passed" },
    "subagent start": { role: "scout", task: "look at the build" },
    "subagent status": {},
    "subagent message": { child: "scout-1", text: "hello" },
    "subagent stop": { child: "scout-1" },
    "workflow list": {},
    "workflow status": {},
    "workflow start": {},
    "workflow bind": { repo: "orders-api" },
    "workflow submit-plan": {},
    "workflow test": {},
    "workflow scenario": { number: 1, result: "passed" },
    "workflow advance": {},
    "workflow back": {},
    "api list": {},
    "api show": { request: "health" },
    "api run": { request: "health", environment: "local" },
    "api run-folder": { folder: "orders", environment: "local" },
    "api call": { environment: "local", method: "GET", url: "https://api.example.com/health" },
    "api postman-environments": {},
};

/** What `classify` says about one action, or why it said nothing. */
function classed(declaration: ToolDeclaration, action: string): CallClass | "unknown" | "needs input" {
    try {
        const input = ACTION_INPUTS[`${declaration.tool} ${action}`] ?? INPUTS[declaration.tool] ?? {};
        const answer = declaration.classify({ action, ...input });
        return answer ?? "unknown";
    } catch (error) {
        if (error instanceof TypeError) return "needs input";
        throw error; // a real failure: jig-core not loaded, or a bug in classify
    }
}

/** What one action's classification is, as the table records it. */
function described(answer: CallClass | "unknown" | "needs input"): string {
    return typeof answer === "string" ? answer : `${answer.environment} ${answer.effect} ${answer.approval ?? "-"}`;
}

describe("what a plugin's documentation says", () => {
    test("every action a tool offers is a row, and its effect and approval are what classify gives it", async () => {
        const failures: string[] = [];
        for (const { plugin, tool, actions, declaration, docs } of await audit()) {
            if (actions.length === 0) continue;
            const rows = actionRows(docs, actions);
            for (const action of actions) {
                if (!rows.has(action)) {
                    failures.push(`${plugin}: ${tool} ${action} is not a row of any table in its docs`);
                    continue;
                }
                const answer = classed(declaration, action);
                if (typeof answer === "string") continue; // unknown, or needs a fuller call: nothing to compare
                const effect = (rows.get(action) ?? "").toLowerCase();
                if (!effect.includes(answer.effect)) {
                    failures.push(
                        `${plugin}: ${tool} ${action} is a ${answer.effect} in code, and the row says "${effect}"`,
                    );
                }
                if (answer.approval === "review" && effect.includes("dialog") && !effect.includes("review")) {
                    failures.push(`${plugin}: ${tool} ${action} asks on the review screen, and the row says "dialog"`);
                }
                if (answer.approval === "dialog" && effect.includes("review") && !effect.includes("dialog")) {
                    failures.push(`${plugin}: ${tool} ${action} asks on a dialog, and the row says "review"`);
                }
            }
        }
        assert.deepEqual(failures, []);
    });
});

describe("what a plugin's classify decides", () => {
    test("is the table this file records, action by action", async () => {
        const found: Record<string, string> = {};
        for (const { tool, actions, declaration } of await audit()) {
            for (const action of actions) found[`${tool} ${action}`] = described(classed(declaration, action));
        }
        assert.deepEqual(found, TABLE);
    });
});

describe("what a plugin's tests name", () => {
    test("is reported, so an action no test names is seen rather than assumed", async () => {
        let actions = 0;
        const gaps: string[] = [];
        for (const { plugin, tool, actions: offered } of await audit()) {
            if (offered.length === 0) continue;
            const text = testText(plugin);
            actions += offered.length;
            const untested = offered.filter((action) => !text.includes(`action: "${action}"`));
            if (untested.length > 0) gaps.push(`${plugin}: ${tool}: ${untested.join(", ")}`);
        }
        console.log(`audit: ${actions} actions; ${gaps.length === 0 ? "every one named by a test" : gaps.join("; ")}`);
    });
});

describe("a tool's own masking", () => {
    test("is a promise its tests can see: a tool that masks its own results is named as masking in them", async () => {
        const failures: string[] = [];
        for (const { plugin, tool, declaration } of await audit()) {
            if (declaration.masksOwnResults !== true) continue;
            if (!testText(plugin).includes("mask"))
                failures.push(`${plugin}: ${tool} masks its own results, and no test says "mask"`);
        }
        assert.deepEqual(failures, []);
    });
});

/** The classification of every action of every tool, as they are today. A change here is deliberate. */
const TABLE: Record<string, string> = {
    "ticket save-evidence": "local write -",
    "ticket add-check": "local write -",
    "ticket list-checks": "local read -",
    "ticket close-check": "local write -",
    "workflow list": "local read -",
    "workflow status": "local read -",
    "workflow start": "local write -",
    "workflow bind": "local write -",
    "workflow submit-plan": "local write review",
    "workflow test": "local write -",
    "workflow scenario": "local write -",
    "workflow advance": "local write -",
    "workflow back": "local write -",
    "subagent start": "local write -",
    "subagent status": "local read -",
    "subagent message": "local write -",
    "subagent stop": "local write -",
    "git status": "local read -",
    "git diff": "local read -",
    "git log": "local read -",
    "git show": "local read -",
    "git blame": "local read -",
    "git branches": "local read -",
    "git fetch": "local read -",
    "git clone": "local write -",
    "git branch": "local write -",
    "git worktree": "local write -",
    "git commit": "local write -",
    "git stash": "local write -",
    "git sync": "local write -",
    "git merge": "local write -",
    "git rebase": "local write -",
    "git cherry_pick": "local write -",
    "git restore": "local write -",
    "git push": "external write -",
    "pr view": "external read -",
    "pr list": "external read -",
    "pr comments": "external read -",
    "pr create": "external write review",
    "pr edit": "external write review",
    "pr ready": "external write -",
    "pr comment": "external write review",
    "pr reply": "external write review",
    "pr resolve": "external write -",
    "pr review": "external write review",
    "pr merge": "external write -",
    "pr watch": "local write -",
    "release tags": "local read -",
    "release releases": "external read -",
    "release tag_create": "local write -",
    "release tag_push": "external write -",
    "release release_create": "external write -",
    "jira get": "external read -",
    "jira search": "external read -",
    "jira comments": "external read -",
    "jira transitions": "external read -",
    "jira changelog": "external read -",
    "jira attachments": "external read -",
    "jira assignable": "external read -",
    "jira find_field": "external read -",
    "jira link_types": "external read -",
    "jira create": "external write review",
    "jira comment": "external write review",
    "jira edit_comment": "external write review",
    "jira delete_comment": "external write dialog",
    "jira transition": "external write dialog",
    "jira update": "external write dialog",
    "jira link": "external write dialog",
    "jira unlink": "external write dialog",
    "api list": "needs input",
    "api show": "needs input",
    "api run": "needs input",
    "api run-folder": "needs input",
    "api call": "needs input",
    "api postman-environments": "needs input",
    "runtime pods": "needs input",
    "runtime rollout": "needs input",
    "runtime logs": "needs input",
    "runtime events": "needs input",
    "runtime health": "needs input",
    "deploy plan": "needs input",
    "deploy run": "needs input",
    "deploy status": "needs input",
    "deploy rollback": "needs input",
    "deploy watch": "needs input",
    "ci status": "needs input",
    "ci runs": "needs input",
    "ci run": "needs input",
    "ci log": "needs input",
    "ci rerun": "needs input",
    "ci trigger": "needs input",
    "ci watch": "needs input",
    "mongo databases": "needs input",
    "mongo collections": "needs input",
    "mongo schema": "needs input",
    "mongo stats": "needs input",
    "mongo indexes": "needs input",
    "mongo index-stats": "needs input",
    "mongo explain": "needs input",
    "mongo count": "needs input",
    "mongo find": "needs input",
    "mongo distinct": "needs input",
    "mongo sample": "needs input",
    "mongo aggregate": "needs input",
    "mongo insert": "needs input",
    "mongo update": "needs input",
    "mongo replace": "needs input",
    "mongo delete": "needs input",
    "mongo bulk": "needs input",
    "mongo create-index": "needs input",
    "mongo drop-index": "needs input",
};

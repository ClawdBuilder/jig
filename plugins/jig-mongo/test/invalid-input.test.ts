// The decision for a mongo call is made from its input alone, so an invalid call is not blocked by `classify` any more:
// jig-core decides from the action and the environment, then builds the preview, and a preview that finds the input
// invalid blocks the call before anyone is asked. These tests drive the real jig-core with mongo's declaration, so the
// path is the one a call takes in a session.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { JigApi } from "../../jig-core/src/contract.ts";
import { start } from "../../jig-core/test/support/harness.ts";
import type { Harness } from "../../jig-core/test/support/harness.ts";
import { tempState } from "../../jig-core/test/support/state.ts";
import { validateMongo } from "../src/config.ts";
import { createTool } from "../src/tool.ts";

const state = tempState();
let harness: Harness | undefined;

/** A staging connection and a denied field; writing it is an invalid call, not a decision to make. */
const CONFIG = {
    environments: { staging: { kind: "test" } },
    mongo: {
        connections: {
            staging: { uri: "mongodb://db.staging.example:27017", user: "agent", password: "env:MONGO_PW" },
        },
    },
};

before(() => state.start());
after(async () => {
    await harness?.shutdown();
    state.stop();
});

/** jig-core with mongo's declaration, deciding and previewing as it does in a session. */
async function gate(): Promise<Harness> {
    const tool = createTool({
        // Nothing must reach a database: every call here is decided before a connection is opened.
        connect: () => {
            throw new Error("a connection was opened for a call that should never have run");
        },
    });
    harness = await start({
        config: CONFIG,
        ui: { select: () => "Allow" },
        plugins: (api: JigApi) => {
            api.config.registerSection("mongo", validateMongo);
            api.declareTool({ tool: "mongo", plugin: "jig-mongo", classify: tool.classify, preview: tool.preview });
        },
    });
    return harness;
}

const update = (set: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    tool: "mongo",
    input: {
        action: "update",
        environment: "staging",
        database: "orders",
        collection: "orders",
        filter: { _id: "1" },
        which: "one",
        update: { $set: set },
        ...extra,
    },
});

test("classification is from the input alone: no section, no environment lookup", () => {
    const tool = createTool({ connect: () => Promise.reject(new Error("no connection")) });
    assert.deepEqual(tool.classify({ action: "update", environment: "staging" }), {
        action: "update",
        environment: "staging",
        effect: "write",
    });
    assert.deepEqual(tool.classify({ action: "find", environment: "staging" }), {
        action: "find",
        environment: "staging",
        effect: "read",
    });
    // `aggregate` is a read or a write by its last stage, and that is in the input too.
    assert.equal(
        tool.classify({ action: "aggregate", environment: "staging", pipeline: [{ $match: {} }] })?.effect,
        "read",
    );
    assert.equal(
        tool.classify({ action: "aggregate", environment: "staging", pipeline: [{ $out: "odd.ball" }] })?.effect,
        "write",
    );
    // An action the tool does not have is left unknown, so it is checked before anyone is asked — and a name every
    // object's prototype carries is not an action.
    assert.equal(tool.classify({ action: "nonesuch", environment: "staging" }), undefined);
    for (const name of ["toString", "constructor", "__proto__", "hasOwnProperty"])
        assert.equal(tool.classify({ action: name, environment: "staging" }), undefined, name);
});

test("an empty filter is blocked before anyone is asked", async () => {
    const h = await gate();
    try {
        const outcome = await h.call(update({ status: "shipped" }, { filter: {} }));
        assert.equal(outcome.blocked, true);
        assert.match(outcome.reason ?? "", /cannot run with this input/);
        assert.match(outcome.reason ?? "", /the filter is empty/);
        assert.equal(h.ui.selects.length, 0, "nobody was asked");
        assert.equal(outcome.ran, false, "and nothing ran");
    } finally {
        await h.shutdown();
    }
});

test("a write naming a denied field is blocked before anyone is asked", async () => {
    const h = await gate();
    try {
        const outcome = await h.call(update({ password: "x" }));
        assert.equal(outcome.blocked, true);
        assert.match(outcome.reason ?? "", /cannot run with this input/);
        assert.match(outcome.reason ?? "", /password/);
        assert.equal(h.ui.selects.length, 0, "nobody was asked");
        assert.equal(outcome.ran, false);
    } finally {
        await h.shutdown();
    }
});

test("a valid staging write still asks, and runs only when approved", async () => {
    const h = await gate();
    try {
        const outcome = await h.call(update({ status: "shipped" }));
        // It asked, and the answer was yes; the connection refuses in the fake, so what matters is the ask.
        assert.equal(h.ui.selects.length, 1, "the valid write asked");
        assert.deepEqual(
            h.decisions().map((d) => [d.tool, d.action, d.environment, d.decision]),
            [["mongo", "update", "staging", "ask"]],
        );
        assert.notEqual(outcome.blocked, true);
    } finally {
        await h.shutdown();
    }
});

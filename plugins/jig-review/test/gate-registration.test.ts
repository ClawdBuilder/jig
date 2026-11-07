import assert from "node:assert/strict";
import { test } from "node:test";
import type { Gate } from "../../jig-core/src/contract.ts";
import { registerReviewGate } from "../src/index.ts";

test("the registered gate reads the coordinator at call time and denies a write while it holds", () => {
    let holding = true;
    let denials = 0;
    let gate: Gate | undefined;
    registerReviewGate(
        { holdsAgent: () => holding, noteHoldDenial: () => void denials++ },
        { gates: { register: (value) => void (gate = value) } },
    );
    assert.ok(gate);
    assert.match(gate.name, /^review-wait:\d+$/);
    const verdict = gate.check({ tool: "edit", effect: "write" } as never, new AbortController().signal) as {
        decision: string;
        reason: string;
    };
    assert.equal(verdict.decision, "deny");
    assert.match(verdict.reason, /send a message to release/);
    assert.equal(denials, 1);
    holding = false;
    assert.equal(gate.check({ tool: "edit", effect: "write" } as never, new AbortController().signal), undefined);
});

test("two registrations get different gate names, so a second copy does not replace the first", () => {
    const names: string[] = [];
    const api = { gates: { register: (gate: Gate) => void names.push(gate.name) } };
    registerReviewGate({ holdsAgent: () => false, noteHoldDenial: () => {} }, api);
    registerReviewGate({ holdsAgent: () => false, noteHoldDenial: () => {} }, api);
    assert.equal(names.length, 2);
    assert.notEqual(names[0], names[1]);
});

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
    assert.equal(gate.name, "review-wait");
    const verdict = gate.check({ tool: "edit", effect: "write" } as never, new AbortController().signal) as {
        decision: string;
        reason: string;
    };
    assert.equal(verdict.decision, "deny");
    assert.match(verdict.reason, /wait for their message/);
    assert.equal(denials, 1);
    holding = false;
    assert.equal(gate.check({ tool: "edit", effect: "write" } as never, new AbortController().signal), undefined);
});

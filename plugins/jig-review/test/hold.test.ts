import assert from "node:assert/strict";
import { test } from "node:test";
import { holdReason, WAIT_REASON } from "../src/hold.ts";

const call = (tool: string, effect: "read" | "write") => ({ tool, effect });

test("the gate holds writes during an open agent review, and lets reads and resolutions through", () => {
    assert.equal(holdReason(call("edit", "write"), true), WAIT_REASON);
    assert.equal(holdReason(call("bash", "write"), true), WAIT_REASON);
    assert.equal(holdReason(call("read", "read"), true), undefined);
    assert.equal(holdReason(call("record_interactive_review_resolution", "write"), true), undefined);
    assert.equal(holdReason(call("start_interactive_code_review", "write"), true), undefined);
});

test("nothing is held when no agent review waits", () => {
    assert.equal(holdReason(call("edit", "write"), false), undefined);
});

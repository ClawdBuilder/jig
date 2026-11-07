import assert from "node:assert/strict";
import { test } from "node:test";
import { holdReason, reviewHoldActive, setReviewHold } from "../src/hold.ts";

test("the shared hold state is what the gate reads, and releases cleanly", () => {
    setReviewHold(false);
    assert.equal(reviewHoldActive(), false);
    assert.equal(holdReason({ tool: "edit", effect: "write" }, reviewHoldActive()), undefined);
    setReviewHold(true);
    assert.equal(reviewHoldActive(), true);
    assert.match(holdReason({ tool: "edit", effect: "write" }, reviewHoldActive()) ?? "", /wait for their message/);
    setReviewHold(false);
    assert.equal(reviewHoldActive(), false);
});

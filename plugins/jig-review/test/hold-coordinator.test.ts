import assert from "node:assert/strict";
import { test } from "node:test";
import { openReview } from "./support/harness.ts";

test("an agent-started review holds, and the person's next message releases it", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        assert.equal(review.coordinator.holdsAgent(), true);
        await review.host.fire("input", review.session.ctx, { text: "continue" });
        assert.equal(review.coordinator.holdsAgent(), false);
    } finally {
        await review.close();
    }
});

test("submitted comments release the review hold", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        assert.equal(review.coordinator.holdsAgent(), true);
        const response = await review.post("/api/comments", { comments: [{ body: "fix the null check" }] });
        assert.equal(response.status, 200);
        assert.equal(review.coordinator.holdsAgent(), false);
    } finally {
        await review.close();
    }
});

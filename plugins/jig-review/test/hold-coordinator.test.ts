import assert from "node:assert/strict";
import { test } from "node:test";
import { openReview } from "./support/harness.ts";

test("an extension message does not release; interactive and rpc do", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        assert.equal(review.coordinator.holdsAgent(), true);
        await review.host.fire("input", review.session.ctx, { text: "child result", source: "extension" });
        assert.equal(review.coordinator.holdsAgent(), true, "an extension message must not release");
        await review.host.fire("input", review.session.ctx, { text: "person", source: "interactive" });
        assert.equal(review.coordinator.holdsAgent(), false, "a person's message releases");
    } finally {
        await review.close();
    }
});

test("a slash command alone does not release; a message does", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        await review.host.run("code-review", "", review.session.ctx);
        assert.equal(review.coordinator.holdsAgent(), true, "there is no command event to release on");
        await review.host.fire("input", review.session.ctx, { text: "person", source: "interactive" });
        assert.equal(review.coordinator.holdsAgent(), false);
    } finally {
        await review.close();
    }
});

test("rpc input from a person releases", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        await review.host.fire("input", review.session.ctx, { text: "person", source: "rpc" });
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

test("holdAgent false stops the hold without releasing a person", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        assert.equal(review.coordinator.holdsAgent(), true);
        const response = await review.patch("/api/settings", { holdAgent: false });
        assert.equal(response.status, 200);
        assert.equal(review.coordinator.holdsAgent(), false);
    } finally {
        await review.close();
    }
});

test("abort counts refused model responses, not parallel calls", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        let aborts = 0;
        const ctx = { ...(review.session.ctx as object), abort: () => void aborts++ } as never;
        await review.host.fire("turn_start", ctx);
        review.coordinator.noteHoldDenial();
        review.coordinator.noteHoldDenial();
        await review.host.fire("turn_end", ctx);
        assert.equal(aborts, 0, "two parallel calls in one response do not abort");
        await review.host.fire("turn_start", ctx);
        review.coordinator.noteHoldDenial();
        await review.host.fire("turn_end", ctx);
        assert.equal(aborts, 1, "the second refused response aborts");
    } finally {
        await review.close();
    }
});

test("an agent start does not claim a review the person opened", async () => {
    const review = await openReview("");
    try {
        assert.equal(review.coordinator.holdsAgent(), false);
        await review.host.tool("start_interactive_code_review", {}, review.session.ctx);
        assert.equal(review.coordinator.holdsAgent(), false, "the person's review stays theirs");
    } finally {
        await review.close();
    }
});

test("a session restart or a stopped server holds nothing", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        assert.equal(review.coordinator.holdsAgent(), true);
        await review.host.fire("session_start", review.session.ctx);
        assert.equal(review.coordinator.holdsAgent(), false, "restart releases");
    } finally {
        await review.close();
    }
});

test("the start result says a person's review is open and nothing is held", async () => {
    const review = await openReview("");
    try {
        const result = await review.host.tool("start_interactive_code_review", {}, review.session.ctx);
        assert.match(result.content[0]?.text ?? "", /already has this review open.*nothing is held/);
    } finally {
        await review.close();
    }
});

test("a company review section supplies defaults, and the person's store overrides it", async () => {
    const review = await openReview("", { byAgent: true, review: { holdAgent: false } });
    try {
        assert.equal(review.coordinator.holdsAgent(), false, "the company section turns the hold off");
        const response = await review.patch("/api/settings", { holdAgent: true });
        assert.equal(response.status, 200);
        assert.equal(review.coordinator.holdsAgent(), true, "the person's setting wins");
    } finally {
        await review.close();
    }
});

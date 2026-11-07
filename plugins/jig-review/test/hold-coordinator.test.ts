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

test("a person's slash command releases, and a new person review releases the old hold", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        await review.host.run("code-review", "", review.session.ctx);
        assert.equal(review.coordinator.holdsAgent(), false, "the command releases the hold");
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

test("abort counts turns, not parallel writes, and takes the context from the call", async () => {
    const review = await openReview("", { byAgent: true });
    try {
        let aborts = 0;
        const ctx = { ...(review.session.ctx as object), abort: () => void aborts++ } as never;
        await review.host.fire("agent_start", ctx);
        review.coordinator.noteHoldDenial();
        review.coordinator.noteHoldDenial();
        assert.equal(aborts, 0, "two calls in one turn do not abort");
        await review.host.fire("agent_start", ctx);
        review.coordinator.noteHoldDenial();
        assert.equal(aborts, 1, "the next turn's refusal aborts");
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

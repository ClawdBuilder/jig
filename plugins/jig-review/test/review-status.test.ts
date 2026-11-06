// The code review's status line says whose turn it is: the person's while the review awaits them, the agent's after
// comments are submitted, and back to the person when the next iteration is ready. The status comes from the review record.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openReview } from "./support/harness.ts";

const WAITING = "review: waiting for you";
const WORKING = "review: agent working";

test("submitted comments hand the status to the agent, and reopening says the agent has it", async () => {
    const session = await openReview("", { byAgent: true });
    try {
        assert.equal(session.session.statuses.get("jig-review"), WAITING);
        const submitted = await session.post("/api/comments", { comments: [{ body: "fix the null check" }] });
        assert.equal(submitted.status, 200);
        assert.equal(session.session.statuses.get("jig-review"), WORKING);

        const notices = session.session.notices.length;
        await session.host.run("code-review", "", session.session.ctx);
        assert.equal(session.session.statuses.get("jig-review"), WORKING);
        assert.equal(session.session.notices.length, notices + 1);
        assert.match(session.session.notices.at(-1) ?? "", /with the agent/);
        assert.doesNotMatch(session.session.notices.at(-1) ?? "", /waiting for you/);
    } finally {
        await session.close();
    }
});

test("an updated review that awaits the person says so even when the reopen prompt is declined", async () => {
    const session = await openReview("", { byAgent: true });
    try {
        await session.post("/api/comments", { comments: [{ body: "fix the null check" }] });
        assert.equal(session.session.statuses.get("jig-review"), WORKING);
        session.session.answer = () => false;
        await session.host.fire("agent_end", session.session.ctx);
        assert.equal(session.session.statuses.get("jig-review"), WAITING);
    } finally {
        await session.close();
    }
});

test("a failed reopen leaves an active review's waiting status alone", async () => {
    const session = await openReview("", { byAgent: true });
    try {
        assert.equal(session.session.statuses.get("jig-review"), WAITING);
        await session.host.run("code-review", "/definitely/not/a/repository", session.session.ctx);
        assert.equal(session.session.statuses.get("jig-review"), WAITING);
        assert.match(session.session.notices.at(-1) ?? "", /not|repository|folder|review/i);
    } finally {
        await session.close();
    }
});

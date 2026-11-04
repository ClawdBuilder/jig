// The one dialog slot. Pi has a single dialog and does not arbitrate between packages, so the review asks through
// jig-core's queue, and a page's approval that arrives while another question is open is told so instead of waiting for
// ever or opening a second dialog.
import assert from "node:assert/strict";
import { test } from "node:test";
import { openReview } from "./support/harness.ts";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check` holds, or fails the test with what was expected. */
async function until(check: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (check()) return;
        await wait(10);
    }
    throw new Error(`timed out waiting for ${what}`);
}

test("a page approval whose dialog slot is taken says so, and opens nothing when its turn comes up", async () => {
    const session = await openReview("", { askQueueWaitMs: 20 });
    try {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const holding = session.jig.approvals.inTurn(async () => {
            await gate;
        });

        const started = Date.now();
        const body = JSON.parse((await session.post("/api/approve/page")).body) as { ok: boolean; message?: string };
        assert.equal(body.ok, false);
        assert.match(body.message ?? "", /Another question is open in Pi/);
        assert.ok(Date.now() - started < 2_000, "the page is answered in bounded time, not left hanging");
        assert.equal(session.session.asked.length, 0, "no dialog opened over the one that was busy");

        release();
        await holding;
        await wait(20);
        assert.equal(session.session.asked.length, 0, "the turn that was told busy opened no dialog when it came up");
        assert.equal(session.records().at(-1)?.status, "awaiting-review", "and approved nothing");
    } finally {
        await session.close();
    }
});

test("with the slot free the page's approval asks in Pi, and only a yes approves", async () => {
    const session = await openReview("", { askQueueWaitMs: 20 });
    try {
        session.session.answer = () => true;
        const body = JSON.parse((await session.post("/api/approve/page")).body) as { ok: boolean; method?: string };
        assert.deepEqual(body, { ok: true, method: "page-and-pi" });
        assert.equal(session.session.asked.length, 1);
    } finally {
        await session.close();
    }
});

test("the review's own tool call does not hold the slot: it runs while the page's question is open", async () => {
    const session = await openReview("", { askQueueWaitMs: 20 });
    try {
        let answer!: (value: boolean) => void;
        session.session.answer = () =>
            new Promise<boolean>((resolve) => {
                answer = resolve;
            });
        const approval = session.post("/api/approve/page");
        await until(() => session.session.asked.length === 1, "the page's question in Pi");

        // Mid-call for the same turn: the tool finishes while the page's question is open, so neither waits on the other.
        const opened = await session.host.tool("start_interactive_code_review", {}, session.session.ctx);
        assert.match(opened.content[0]?.text ?? "", /Review opened/);

        answer(true);
        const body = JSON.parse((await approval).body) as { ok: boolean; method?: string };
        assert.deepEqual(body, { ok: true, method: "page-and-pi" });
        assert.equal(session.session.asked.length, 1, "the tool opened no second dialog");
    } finally {
        await session.close();
    }
});

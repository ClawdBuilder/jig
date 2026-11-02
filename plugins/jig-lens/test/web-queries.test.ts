// The figures behind the `/lens web` page, asked of an index imported from the sample records in support.ts (and, for
// loops, a few records of their own). The expected numbers are worked out by hand from those records.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scope } from "../src/queries.ts";
import {
    daysOf,
    LOOP_LENGTH,
    loopsOf,
    sessionsOf,
    ticketSessionsOf,
    ticketsOf,
    timelineOf,
    toolTableOf,
    totalsOf,
    yourTimeOf,
} from "../src/web-queries.ts";
import { call, indexOf, sampleDb, turn } from "./support.ts";

const second = (iso: string) => Date.parse(iso) / 1000;
const ALL: Scope = { kind: "period", from: second("2026-10-01T00:00:00Z"), to: second("2026-11-30T00:00:00Z") };
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual}`);

test("the totals of a range come from the summary's own queries", async (t) => {
    const db = await sampleDb(t);
    const totals = totalsOf(db, ALL);
    close(totals.cost, 0.46);
    assert.equal(totals.turns, 6);
    assert.equal(totals.calls, 14);
    assert.equal(totals.failed, 3);
    assert.equal(totals.blocked, 3);
    assert.equal(totals.questions, 4);
    assert.equal(totals.waitedMs, 3000 + 1500 + 9000 + 800);
    assert.equal(totals.output, 1200);
    // Cache reads are 31 000 of 6 000 new + 31 000 read + 500 written.
    close(totals.cacheHit ?? 0, 31_000 / 37_500);
});

test("an empty range has zeros and no cache share", async (t) => {
    const db = await sampleDb(t);
    const totals = totalsOf(db, { kind: "period", from: 0, to: 1 });
    assert.deepEqual(totals, {
        cost: 0,
        input: 0,
        output: 0,
        cacheHit: undefined,
        turns: 0,
        calls: 0,
        failed: 0,
        blocked: 0,
        questions: 0,
        waitedMs: 0,
    });
});

test("every day of the range has a row, and a day with nothing has zeros", async (t) => {
    const db = await sampleDb(t);
    // Local midnights, as the page asks for them.
    const from = new Date(2026, 9, 26).getTime() / 1000;
    const to = new Date(2026, 9, 31).getTime() / 1000;
    const days = daysOf(db, from, to);
    assert.deepEqual(
        days.map((day) => day.day),
        ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"],
    );
    close(
        days.reduce((sum, day) => sum + day.cost, 0),
        0.46,
    );
    assert.equal(
        days.reduce((sum, day) => sum + day.calls, 0),
        14,
    );
    assert.equal(days[0]?.cost, 0);
});

test("each session has its cost, calls, failures and waits, the most recent first", async (t) => {
    const db = await sampleDb(t);
    const sessions = sessionsOf(db, ALL);
    assert.deepEqual(
        sessions.map((row) => row.session),
        ["s1", "s2", "s3"],
    );
    const s1 = sessions.find((row) => row.session === "s1");
    assert.ok(s1);
    close(s1.cost, 0.35);
    assert.equal(s1.turns, 3);
    assert.equal(s1.calls, 8);
    assert.equal(s1.failed, 1);
    assert.equal(s1.blocked, 1);
    assert.equal(s1.questions, 2);
    assert.equal(s1.waitedMs, 3800);
    assert.deepEqual(s1.tickets, ["T-1"]);
    assert.equal(s1.first, second("2026-10-27T09:00:00Z"));
    assert.equal(s1.last, second("2026-10-30T09:03:00Z"));
    const s3 = sessions.find((row) => row.session === "s3");
    assert.equal(s3?.agentRole, "reviewer");
    assert.equal(s3?.parentSession, "s1");
});

test("tickets are counted from the lines that carry them", async (t) => {
    const db = await sampleDb(t);
    const [ticket, ...others] = ticketsOf(db, ALL);
    assert.deepEqual(others, []);
    assert.equal(ticket?.ticket, "T-1");
    assert.equal(ticket?.sessions, 1);
    close(ticket?.cost ?? 0, 0.35);
    assert.equal(ticket?.calls, 8);
    assert.equal(ticket?.failed, 1);
    assert.equal(ticket?.waitedMs, 3800);
});

test("a ticket's sessions list the tools each used on it, most calls first", async (t) => {
    const db = await sampleDb(t);
    const [session] = ticketSessionsOf(db, "T-1");
    assert.equal(session?.session, "s1");
    assert.deepEqual(session?.tools.slice(0, 2), [
        { tool: "bash", action: undefined, calls: 2, failed: 1 },
        { tool: "git", action: "push", calls: 2, failed: 0 },
    ]);
    assert.deepEqual(ticketSessionsOf(db, "NOPE-1"), []);
});

test("a session's timeline has every turn and call in order, with its child agent nested where it started", async (t) => {
    const db = await sampleDb(t);
    const timeline = timelineOf(db, "s1");
    assert.ok(timeline);
    assert.equal(timeline.cut, false);
    const kinds = timeline.lines.map((line) => line.kind);
    assert.equal(kinds.filter((kind) => kind === "turn").length, 3);
    assert.equal(kinds.filter((kind) => kind === "call").length, 8);
    const times = timeline.lines.map((line) => line.time);
    assert.deepEqual(
        times,
        [...times].sort((a, b) => a - b),
    );
    const child = timeline.lines.find((line) => line.kind === "child");
    assert.ok(child?.kind === "child");
    assert.equal(child.timeline.session, "s3");
    assert.equal(child.timeline.agentRole, "reviewer");
    assert.equal(child.timeline.lines.length, 3);
    assert.equal(child.time, second("2026-10-29T08:00:00Z"));

    const push = timeline.lines.find((line) => line.kind === "call" && line.action === "push");
    assert.ok(push?.kind === "call");
    assert.equal(push.decision, "ask");
    assert.equal(push.answer, "allow");
    assert.equal(push.waitedMs, 3000);
    assert.equal(timelineOf(db, "nobody"), undefined);
});

test("the child's facts come back as an object", async (t) => {
    const db = await sampleDb(t);
    const timeline = timelineOf(db, "s3");
    const ci = timeline?.lines.find((line) => line.kind === "call" && line.tool === "ci");
    assert.ok(ci?.kind === "call");
    assert.deepEqual(ci.facts, { conclusion: "success", passed: 12, failed: 0 });
});

test("every tool has its calls, failures, blocks and p50 and p95 durations", async (t) => {
    const db = await sampleDb(t);
    const tools = toolTableOf(db, ALL);
    const bash = tools.find((row) => row.tool === "bash");
    assert.deepEqual(bash, {
        tool: "bash",
        action: undefined,
        calls: 4,
        failed: 1,
        blocked: 2,
        p50Ms: 300,
        p95Ms: 1200,
    });
    const http = tools.find((row) => row.tool === "http");
    assert.equal(http?.p50Ms, undefined, "a call that never ran has no duration");
    assert.equal(tools[0]?.tool, "bash", "most calls first");
});

test("a loop is the same tool failing three times in a row in a session; a success breaks it, another tool does not", async (t) => {
    const fail = { outcome: "error" as const, errorKind: "tool" as const, error: "exit code 1" };
    const db = await indexOf(t, [
        // A loop of four: a read between the failures does not break it.
        call("a1", "2026-10-30T09:00:00Z", "s1", "bash", { ...fail, ticket: "T-1" }),
        call("a2", "2026-10-30T09:01:00Z", "s1", "read"),
        call("a3", "2026-10-30T09:02:00Z", "s1", "bash", { ...fail, ticket: "T-1" }),
        call("a4", "2026-10-30T09:03:00Z", "s1", "bash", { ...fail, ticket: "T-1" }),
        call("a5", "2026-10-30T09:04:00Z", "s1", "bash", { ...fail, ticket: "T-1" }),
        // Two failures, a success, two failures: no loop.
        call("b1", "2026-10-30T09:00:00Z", "s2", "git", { ...fail, action: "push" }),
        call("b2", "2026-10-30T09:01:00Z", "s2", "git", { ...fail, action: "push" }),
        call("b3", "2026-10-30T09:02:00Z", "s2", "git", { action: "push" }),
        call("b4", "2026-10-30T09:03:00Z", "s2", "git", { ...fail, action: "push" }),
        call("b5", "2026-10-30T09:04:00Z", "s2", "git", { ...fail, action: "push" }),
        // Blocked three times: the agent asks again for what a rule refuses.
        call("c1", "2026-10-30T09:00:00Z", "s3", "http", { outcome: "blocked", errorKind: "denied" }),
        call("c2", "2026-10-30T09:01:00Z", "s3", "http", { outcome: "blocked", errorKind: "denied" }),
        call("c3", "2026-10-30T09:02:00Z", "s3", "http", { outcome: "blocked", errorKind: "denied" }),
        // The same tool failing in two sessions is two runs, not one.
        call("d1", "2026-10-30T09:00:00Z", "s4", "edit", fail),
        call("d2", "2026-10-30T09:01:00Z", "s4", "edit", fail),
        call("e1", "2026-10-30T09:02:00Z", "s5", "edit", fail),
        turn("t1", "2026-10-30T09:00:00Z", "s1", "model-a", 0.01),
    ]);
    assert.equal(LOOP_LENGTH, 3);
    const loops = loopsOf(db, ALL);
    assert.deepEqual(loops, [
        {
            tool: "bash",
            action: undefined,
            session: "s1",
            ticket: "T-1",
            failures: 4,
            from: second("2026-10-30T09:00:00Z"),
            to: second("2026-10-30T09:04:00Z"),
            errorKind: "tool",
        },
        {
            tool: "http",
            action: undefined,
            session: "s3",
            ticket: undefined,
            failures: 3,
            from: second("2026-10-30T09:00:00Z"),
            to: second("2026-10-30T09:02:00Z"),
            errorKind: "denied",
        },
    ]);
});

test("your time: the questions, how they were answered, and the waits by tool, by ticket and longest first", async (t) => {
    const db = await sampleDb(t);
    const time = yourTimeOf(db, ALL);
    assert.ok(time);
    assert.equal(time.questions, 4);
    assert.equal(time.totalMs, 14_300);
    assert.equal(time.longestMs, 9000);
    assert.equal(time.medianMs, (1500 + 3000) / 2);
    assert.deepEqual(time.answers, { allowed: 1, allowedForSession: 1, declined: 1, dismissed: 1 });
    assert.deepEqual(time.byTool, [
        { name: "bash", questions: 2, waitedMs: 10_500, longestMs: 9000 },
        { name: "git push", questions: 2, waitedMs: 3800, longestMs: 3000 },
    ]);
    assert.deepEqual(time.byTicket, [
        { name: "", questions: 2, waitedMs: 10_500, longestMs: 9000 },
        { name: "T-1", questions: 2, waitedMs: 3800, longestMs: 3000 },
    ]);
    assert.deepEqual(
        time.longest.map((question) => [question.session, question.waitedMs, question.answer]),
        [
            ["s2", 9000, "decline"],
            ["s1", 3000, "allow"],
            ["s2", 1500, "decline"],
            ["s1", 800, "allow-session"],
        ],
    );
    assert.equal(yourTimeOf(db, { kind: "period", from: 0, to: 1 }), undefined);
});

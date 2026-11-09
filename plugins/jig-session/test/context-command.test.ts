// The `/context` report: Jig's messages found by their custom types, tool ownership and the lines the terminal shows.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MEMORY_NOTES_MESSAGE } from "../../jig-core/src/kit/jig-messages.ts";
import { buildReport, jigMessages, reportLines } from "../src/context-command.ts";
import type { ContextReport } from "../src/context-command.ts";
import type { ContextDetail } from "../src/context.ts";

const detail: ContextDetail = {
    window: 1000,
    used: 500,
    usedFrom: "pi",
    reserve: 100,
    free: 400,
    parts: { messages: 100, tools: 200, system: 100, skills: 50, contextFiles: 50 },
    tools: [
        { name: "git", on: true, tokens: 100 },
        { name: "bash", on: true, tokens: 50 },
        { name: "mongo", on: false, tokens: 70 },
        { name: "logs", on: true, tokens: 30 },
    ],
    skills: [],
    files: [],
};

const paint = (_role: string, text: string): string => text;

test("Jig's custom messages get their labels, their counts and their tokens", () => {
    const messages = jigMessages([
        { type: "custom_message", customType: MEMORY_NOTES_MESSAGE, content: "notes ".repeat(40) },
        { type: "message", message: { role: "user", content: "Interactive code review approved" } },
        { type: "message", message: { role: "assistant", content: "not a Jig message" } },
        { type: "custom", customType: "jig-other", data: {} },
        { type: "custom_message", customType: "unknown", content: "ignored" },
    ]);
    assert.deepEqual(
        messages.map((message) => [message.label, message.count]),
        [
            ["Ticket notes", 1],
            ["Review follow-ups", 1],
        ],
    );
    assert.ok(messages.every((message) => message.tokens > 0));
});

test("buildReport leaves out off and deferred tools, groups by owner and sorts the deferred names", () => {
    const report = buildReport({
        detail,
        model: "faux/model",
        declared: new Map([["git", "jig-git"]]),
        deferred: ["logs", "z-deferred"],
        jigLoaded: true,
        entries: [{ type: "custom_message", customType: MEMORY_NOTES_MESSAGE, content: "ticket notes" }],
    });
    assert.deepEqual(
        report.groups.map((group) => [group.label, group.tools.map((tool) => tool.name)]),
        [
            ["Pi built-in / other", ["bash"]],
            ["jig-git", ["git"]],
        ],
    );
    assert.deepEqual(report.deferred, ["logs", "z-deferred"]);
    assert.deepEqual(
        report.messages.map((message) => message.label),
        ["Ticket notes"],
    );
});

test("reportLines shows the window, the parts, the tools, the deferred names and Jig's messages", () => {
    const report: ContextReport = buildReport({
        detail,
        model: "faux/model",
        declared: new Map([["git", "jig-git"]]),
        deferred: ["logs"],
        jigLoaded: true,
        entries: [{ type: "custom_message", customType: MEMORY_NOTES_MESSAGE, content: "ticket notes" }],
    });
    const lines = reportLines(report, 80, paint, { hint: false }).join("\n");
    assert.match(lines, /Context · faux\/model/);
    assert.match(lines, /Window 1,000 · Used 500 \(50.0%\)/);
    assert.match(lines, /System prompt/);
    assert.match(lines, /Compaction reserve/);
    assert.match(lines, /Tools/);
    assert.match(lines, /jig-git/);
    assert.match(lines, /Deferred \(found by tool_search\)/);
    assert.match(lines, /logs\s+not in context/);
    assert.match(lines, /Jig messages \(apart from conversation\)/);
    assert.match(lines, /Ticket notes/);
    assert.doesNotMatch(lines, /q or Esc closes/);
});

test("without Jig loaded the other tools get the honest group name", () => {
    const report = buildReport({ detail, model: "m", declared: new Map(), jigLoaded: false });
    assert.equal(report.groups[0]?.label, "Jig not loaded (Pi / other tools)");
    assert.deepEqual(report.messages, []);
});

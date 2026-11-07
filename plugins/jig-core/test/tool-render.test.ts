// The default timeline renderers in `registerJigTool`: one line for the call, one for the result, detail only on expand.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerJigTool } from "../src/kit/tools.ts";
import { fakePi } from "./support/fake-pi.ts";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

function tool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
    return {
        name: "pr",
        label: "Pull request",
        description: "test",
        parameters: { type: "object", properties: {} } as never,
        async execute() {
            return { content: [{ type: "text", text: "ok" }], details: {} };
        },
        ...overrides,
    } as ToolDefinition;
}

function registered(value: ToolDefinition, summary?: (args: Readonly<Record<string, unknown>>) => string | undefined) {
    const fake = fakePi();
    registerJigTool(fake.pi, value, summary === undefined ? {} : { summary });
    return fake.registered.get(value.name) as ToolDefinition & {
        renderCall: (
            args: Record<string, unknown>,
            theme: unknown,
            context: unknown,
        ) => { render: (width: number) => string[] };
        renderResult: (
            result: { content: { type: string; text: string }[]; isError?: boolean },
            options: { expanded: boolean; isPartial: boolean },
            theme: unknown,
            context: unknown,
        ) => { render: (width: number) => string[] };
    };
}

function line(component: { render: (width: number) => string[] }, width = 200): string {
    return component
        .render(width)
        .map((one) => one.trimEnd())
        .join("\n");
}

describe("the default tool renderers", () => {
    test("a call is one line: tool, action and the identifying arguments, never the body", () => {
        const value = registered(tool());
        const shown = line(
            value.renderCall(
                { action: "create", branch: "feature/X", base: "develop", title: "A long title", body: "a whole body" },
                theme,
                {},
            ),
        );
        assert.equal(shown, "pr create  feature/X -> develop");
        assert.ok(!shown.includes("a whole body"));
        assert.ok(!shown.includes("A long title"));
    });

    test("jira and logs get their ticket and environment, not their query", () => {
        const jira = registered(tool({ name: "jira" }));
        assert.equal(
            line(jira.renderCall({ action: "get", key: "PROJ-123", query: "text" }, theme, {})),
            "jira get  PROJ-123",
        );
        const logs = registered(tool({ name: "logs" }));
        assert.equal(
            line(logs.renderCall({ action: "search", environment: "staging", phrase: "an exact phrase" }, theme, {})),
            "logs search  staging",
        );
    });

    test("a tool's own summary is used instead of the guessed arguments", () => {
        const value = registered(tool(), () => "pr create  feature/X -> develop");
        assert.equal(
            line(value.renderCall({ action: "create", branch: "feature/X", base: "develop" }, theme, {})),
            "pr create  feature/X -> develop",
        );
    });

    test("a result is one line, and the full text is there only when expanded", () => {
        const value = registered(tool());
        const result = { content: [{ type: "text", text: "first line\nsecond line" }] };
        assert.equal(
            line(value.renderResult(result, { expanded: false, isPartial: false }, theme, {})),
            "✓ first line",
        );
        assert.equal(
            line(value.renderResult(result, { expanded: true, isPartial: false }, theme, {})),
            "first line\nsecond line",
        );
    });

    test("an error shows its first line with the error mark", () => {
        const value = registered(tool());
        const result = { content: [{ type: "text", text: "the remote refused\nmore" }], isError: true };
        assert.equal(
            line(value.renderResult(result, { expanded: false, isPartial: false }, theme, {})),
            "✗ the remote refused",
        );
    });

    test("masking stays exactly as the model received it, collapsed and expanded", () => {
        const value = registered(tool());
        const result = { content: [{ type: "text", text: "token [redacted] here\nmore" }] };
        assert.match(
            line(value.renderResult(result, { expanded: false, isPartial: false }, theme, {})),
            /\[redacted\]/,
        );
        assert.match(line(value.renderResult(result, { expanded: true, isPartial: false }, theme, {})), /\[redacted\]/);
        assert.equal(result.content[0]?.text, "token [redacted] here\nmore", "display does not change the result");
    });

    test("a tool's own renderer is kept, and its execute is wrapped only to mark a refusal", () => {
        const own = () => ({ render: () => ["own"] });
        const original = tool({ renderCall: own as never });
        const value = registered(original);
        assert.equal(value.renderCall, own);
        assert.notEqual(value.execute, original.execute, "the wrapper marks a RefusedError");
        assert.equal(typeof value.execute, "function");
    });

    test("a long call is truncated to the width, not wrapped", () => {
        const value = registered(tool());
        const shown = value
            .renderCall({ action: "get", key: "a".repeat(200) }, theme, {})
            .render(20)
            .join("\n");
        assert.equal(shown.split("\n").length, 1);
    });
});

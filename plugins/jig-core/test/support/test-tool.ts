// A tool for the tests of the tool contract: an `EngineTool` with a `classify`, a `preview` with a fingerprint and an `execute`, that
// names no agent. The engine's tests (`test/engine/`) run it through `judge` and `run`; `engine-tool.test.ts` runs it in Pi through
// `registerEngineTool`. It plans a call in one place, so that its preview and its `execute` can be told apart as a real tool's are:
// `execute` plans again and refuses to run when the plan is not the one the question showed.
import { createHash } from "node:crypto";
import type { CallClass, Preview } from "../../src/contract.ts";
import type { CallContext, EngineTool, ToolResult } from "../../src/engine-tool.ts";
import { RefusedError } from "../../src/kit/values.ts";

/** What the tool was handed, by each of its three functions, in order. */
export interface Handed {
    classify: Array<string | undefined>;
    preview: Array<string | undefined>;
    execute: Array<{ cwd: string; seen: Preview | undefined; hasProgress: boolean; hasSignal: boolean }>;
}

/** A value that looks like a GitHub token, made from parts so that no such text is written in this file. */
export const TOKEN_SHAPED = `ghp_${"Ab3dE6gH9j".repeat(4)}`;

const ACTIONS = ["read", "write", "report", "refuse", "fail", "leak", "folder"] as const;

export function stampTool(): { tool: EngineTool; handed: Handed } {
    const handed: Handed = { classify: [], preview: [], execute: [] };
    const stamps: string[] = [];

    const planOf = (input: Readonly<Record<string, unknown>>, cwd: string | undefined) => {
        const text = String(input.text ?? "");
        const line = `${String(input.action)} ${text}`.trim();
        return {
            line,
            fingerprint: createHash("sha256")
                .update(JSON.stringify([line, cwd]))
                .digest("hex")
                .slice(0, 16),
        };
    };

    const tool: EngineTool = {
        tool: "stamp",
        plugin: "jig-test",
        label: "Stamp",
        description: "Keeps a list of stamps: read it, add one, or report on the customers.",
        promptSnippet: "stamp: read or add a stamp",
        promptGuidelines: ["Add a stamp only when asked."],
        input: {
            type: "object",
            properties: {
                action: { type: "string", enum: [...ACTIONS] },
                text: { type: "string" },
            },
            required: ["action"],
            additionalProperties: false,
        },
        sequential: true,
        classify(input, cwd): CallClass {
            handed.classify.push(cwd);
            switch (input.action) {
                case "write":
                    return { action: "write", environment: "external", effect: "write" };
                case "report":
                    return { action: "report", environment: "production", effect: "read" };
                case "read":
                case "refuse":
                case "fail":
                case "leak":
                case "folder":
                    return { action: String(input.action), environment: "local", effect: "read" };
                default:
                    throw new TypeError(`stamp: unknown action ${String(input.action)}`);
            }
        },
        async preview(input, _signal, cwd): Promise<Preview> {
            handed.preview.push(cwd);
            const plan = planOf(input, cwd);
            return {
                summary: `stamp ${plan.line}`,
                body: `This adds the stamp "${String(input.text ?? "")}".`,
                fingerprint: plan.fingerprint,
            };
        },
        async execute(input, call: CallContext): Promise<ToolResult> {
            handed.execute.push({
                cwd: call.cwd,
                seen: call.seen,
                hasProgress: call.progress !== undefined,
                hasSignal: call.signal instanceof AbortSignal,
            });
            // The tool plans again, and does nothing when the plan is not the one that was shown.
            const plan = planOf(input, call.cwd);
            if (call.seen?.fingerprint !== undefined && call.seen.fingerprint !== plan.fingerprint) {
                throw new Error("stamp changed since the preview, so nothing was stamped");
            }
            switch (input.action) {
                case "write":
                    call.progress?.("stamping");
                    stamps.push(String(input.text ?? ""));
                    return {
                        text: `stamped ${String(input.text ?? "")}`,
                        data: { stamps: [...stamps] },
                        facts: { stamps: stamps.length },
                    };
                case "read":
                    return { text: `stamps: ${stamps.join(", ") || "none"}`, data: { stamps: [...stamps] } };
                case "report":
                    return { text: "customer: jane.doe@example.com", data: { customer: "jane.doe@example.com" } };
                case "refuse":
                    throw new RefusedError("stamp refused: the press is closed today");
                case "fail":
                    throw new Error("the stamp press jammed");
                case "leak":
                    return { text: `the token is ${TOKEN_SHAPED}`, data: { token: TOKEN_SHAPED } };
                default:
                    return { text: `folder ${call.cwd}` };
            }
        },
    };
    return { tool, handed };
}

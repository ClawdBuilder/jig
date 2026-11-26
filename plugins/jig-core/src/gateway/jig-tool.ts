// The `jig` tool: Jig's own tool in the gateway. In this phase it has one action, `status`, which says what the gateway decided lately and what is
// wrong with the settings. It is declared to the engine as a local read for every action (`classify`), so it never asks about itself, and it is
// recorded like any other call because the engine runs it (`engine.run`).
import type { EngineTool } from "../engine-tool.ts";

/** How many outcomes `status` lists. */
export const STATUS_OUTCOMES = 20;

/** What the gateway decided about one call, kept in memory for `status`. */
export interface GatewayOutcome {
    /** ISO time, to the second. */
    time: string;
    tool: string;
    action?: string;
    /** The decision (`allow`), or the line that refused the call. */
    result: string;
    /** True when `result` is a refusal. */
    refused: boolean;
}

/** What `status` reads. Each is read when the tool runs, because the settings are read at the first call. */
export interface StatusSource {
    /** The newest last. The source keeps at most `STATUS_OUTCOMES`. */
    outcomes(): readonly GatewayOutcome[];
    /** One line for each problem found in jig.json. */
    problems(): readonly string[];
    /** A line about the settings when there is something to say, such as that none were found. */
    settings(): string | undefined;
    /** Lines about parts of the gateway that did not start, such as a connector that could not be loaded. */
    startup(): readonly string[];
}

function outcomeLine(outcome: GatewayOutcome): string {
    const what = outcome.action === undefined ? outcome.tool : `${outcome.tool} ${outcome.action}`;
    return `${outcome.time} ${what}: ${outcome.refused ? "refused. " : ""}${outcome.result}`;
}

/** The text of `status`. */
export function statusText(source: StatusSource): string {
    const outcomes = source.outcomes().slice(-STATUS_OUTCOMES);
    const lines: string[] = [];
    const settings = source.settings();
    if (settings !== undefined) lines.push(settings);
    lines.push(...source.startup());
    const problems = source.problems();
    for (const problem of problems) lines.push(`jig.json: ${problem}`);
    if (problems.length > 0) lines.push("Run `jig doctor` to see these problems in full.");
    lines.push(
        outcomes.length === 0
            ? "This gateway has not decided a call yet."
            : `The last ${outcomes.length === 1 ? "call" : `${outcomes.length} calls`} this gateway decided, the newest last:`,
        ...outcomes.map(outcomeLine),
    );
    return lines.join("\n");
}

/** The tool, over what it reads. */
export function jigTool(source: StatusSource): EngineTool {
    return {
        tool: "jig",
        plugin: "jig-core",
        label: "Jig",
        description:
            "Jig's own tool. status: the last calls Jig decided in this server, with the decision or the reason a call was refused, and any problem in the settings.",
        input: {
            type: "object",
            properties: {
                action: {
                    type: "string",
                    enum: ["status"],
                    description: "- status: what Jig decided lately, and what is wrong with its settings",
                },
            },
            required: ["action"],
            additionalProperties: false,
        },
        // Every action is a read of what this process kept, so `jig` never asks about itself.
        classify: (input) => ({
            action: typeof input.action === "string" ? input.action : "status",
            environment: "local",
            effect: "read",
        }),
        async execute(input) {
            if (input.action !== "status") return { text: "jig: the only action is status.", isError: true };
            return { text: statusText(source) };
        },
    };
}

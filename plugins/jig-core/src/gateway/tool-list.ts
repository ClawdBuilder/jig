// What the gateway tells an agent about one tool: an entry of the tool list. It is made from an `EngineTool`, which an agent that is not Pi
// reads as an MCP tool. Pi's own fields (`promptSnippet`, `promptGuidelines`) are not sent; nor are the engine's (`classify`, `preview`), which
// stay in the engine. Only what the model reads and what the gateway needs to run the call is kept.
import type { EngineTool, JsonSchema } from "../engine-tool.ts";

/** What the `dir` parameter says. A folder the model names is checked before a call goes on (`runtime.ts`). */
export const DIR_DESCRIPTION =
    "The folder you work in, as an absolute path to a folder that exists. Omit it for the folder the Jig server was started in. To use another repository of the workspace, name it with repo.";

/** One tool, as the gateway lists it and runs it. */
export interface ToolListEntry {
    name: string;
    title: string;
    description: string;
    /** The parameters as the agent sees them: with `dir` for a tool that works on a folder, and without the actions that are not offered. */
    inputSchema: JsonSchema;
    /** The plugin whose connector gave the tool. */
    connector: string;
    /** Calls to it run one at a time. */
    sequential: boolean;
    /** The call may carry `dir`, which the gateway takes out before the engine sees the input. */
    usesFolder: boolean;
    /** The actions the call flow refuses, though a form that was not made by the gateway might name them. */
    notOffered: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parameters an agent is shown. It is a copy: the tool's own schema is not changed, because Pi shows the same tool with it.
 * - A tool that works on a folder gets one more optional text, `dir`.
 * - The actions a connector does not offer are taken out of the `action` list, and out of the lines of its description that name them
 *   (`- watch: ...`), so that the model is not told about what it cannot do.
 */
export function mcpInputSchema(
    tool: string,
    input: JsonSchema,
    options: { usesFolder: boolean; notOffered: readonly string[] },
): JsonSchema {
    // Through JSON: a plain copy that a client can read, with no symbol keys or functions that a schema builder might leave on it.
    const schema = JSON.parse(JSON.stringify(input)) as JsonSchema;
    const properties = isRecord(schema.properties) ? schema.properties : undefined;

    const action = properties?.action;
    if (options.notOffered.length > 0 && isRecord(action)) {
        if (Array.isArray(action.enum))
            action.enum = action.enum.filter((value) => !options.notOffered.includes(String(value)));
        if (typeof action.description === "string") {
            action.description = action.description
                .split("\n")
                .filter((line) => !options.notOffered.some((name) => line.startsWith(`- ${name}:`)))
                .join("\n");
        }
    }

    if (options.usesFolder) {
        if (properties !== undefined && "dir" in properties) {
            throw new Error(`${tool} works on a folder and already has a parameter named dir`);
        }
        schema.properties = { ...properties, dir: { type: "string", description: DIR_DESCRIPTION } };
    }
    return schema;
}

/** The entry for a tool. `notOffered` are the actions its connector keeps back. */
export function describeTool(tool: EngineTool, connector: string, notOffered: readonly string[] = []): ToolListEntry {
    const usesFolder = tool.usesFolder === true;
    return {
        name: tool.tool,
        title: tool.label,
        description: tool.description,
        inputSchema: mcpInputSchema(tool.tool, tool.input, { usesFolder, notOffered }),
        connector,
        sequential: tool.sequential === true,
        usesFolder,
        notOffered,
    };
}

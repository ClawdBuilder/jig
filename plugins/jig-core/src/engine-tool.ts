// The tool contract of the engine: what a tool is, what it is handed when it runs and what it gives back. A tool written to this contract
// names no agent, so the engine's own `run` (`engine-run.ts`) and Pi's wrapper (`registerEngineTool` in `kit/tools.ts`) can both run it.
// `executeTool` is the step they share: in Pi the agent's own events clean the result and write the record afterwards, in the engine `run` does.
import type { Facts, JigApi, Preview, ToolDeclaration } from "./contract.ts";

/** A JSON Schema object, as the tool's parameters. A TypeBox schema is one. */
export type JsonSchema = Record<string, unknown>;

/** What a tool is handed when it runs. */
export interface CallContext {
    /** The agent's id for this call. */
    callId: string;
    /** The working folder of this call, from the host. */
    cwd: string;
    /** Cancelled when the agent cancels the call. */
    signal: AbortSignal;
    /** The preview the question showed, when the call asked. A tool compares it with what it would do now. */
    seen?: Preview;
    /** Says a line while the call runs, where the agent shows one. Missing where it does not. */
    progress?(text: string): void;
    /** Secrets, http, masking and the rest, as a tool reaches them today. */
    jig: JigApi;
}

/** What a tool gives back. An error is a result with `isError`, or a thrown error; a refusal by the tool's own rules is a `RefusedError`. */
export interface ToolResult {
    /** What the model reads. */
    text: string;
    /** The same result as structured data, when the tool has it. It is cleaned like the text and never read to understand the text. */
    data?: unknown;
    isError?: boolean;
    /** Named numbers, flags or short codes for this call's record: what a tool in Pi adds with `jig().addFacts`. */
    facts?: Facts;
}

/**
 * A tool and its declaration in one object: it is what `declareTool` takes (`classify`, `preview` and the rest of `ToolDeclaration`), and
 * it says how the tool is shown and run. `label`, `description`, `input` and `execute` are all the model and the host need.
 */
export interface EngineTool extends ToolDeclaration {
    /** The short name a person sees. */
    label: string;
    /** What the model reads. It has to be true in every agent. */
    description: string;
    /** Pi only: the line in Pi's list of tools. */
    promptSnippet?: string;
    /** Pi only: rules of use that hold in Pi. */
    promptGuidelines?: string[];
    /** The parameters. */
    input: JsonSchema;
    /** Runs alone and in order: Pi's `executionMode: "sequential"`. */
    sequential?: boolean;
    /** Works on the folder you are in: where there is no such folder, its form has a `dir` parameter that becomes `call.cwd`. */
    usesFolder?: boolean;
    execute(input: Record<string, unknown>, call: CallContext): Promise<ToolResult>;
}

/**
 * Whether an error is a tool refusing by its own rules: the kit's `RefusedError`. It is told by its name, because a plugin that was
 * loaded on its own has its own copy of the class, and `instanceof` would not see it.
 */
export function isRefusal(error: unknown): boolean {
    return error instanceof Error && error.name === "RefusedError";
}

/**
 * The step the engine and Pi's wrapper share: calls the tool's `execute` and checks what came back, which is another package's code.
 * A tool that refuses by its own rules throws a `RefusedError`: `refused` is told first, and the error goes on for the caller to turn
 * into what its host shows. Nothing is cleaned or recorded here.
 */
export async function executeTool(
    tool: EngineTool,
    input: Record<string, unknown>,
    call: CallContext,
    refused: () => void,
): Promise<ToolResult> {
    let result: ToolResult;
    try {
        result = await tool.execute(input, call);
    } catch (error) {
        if (isRefusal(error)) refused();
        throw error;
    }
    if (typeof result !== "object" || result === null || typeof result.text !== "string") {
        throw new TypeError(`${tool.tool} gave no result text`);
    }
    return result;
}

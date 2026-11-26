// What the three tools have in common. A tool is its parameter schema, its table of actions, how an action is classified,
// and `plan`: the one function that checks a call and works out what it would do. From those this file builds a Jig tool,
// in one of two ways.
// `buildTool` (the `git` tool) builds both halves of a tool for Pi:
//   - the Pi tool, whose execute() plans, compares the plan with the preview the user approved, and runs it;
//   - the declaration for jig-core, whose preview() is the same plan, and whose classify() says where it acts.
// `buildEngineTool` (`pr` and `release`) builds one `EngineTool`, which names no agent: its execute() takes the folder and the approved
// preview from the call it is handed, and Pi and a gateway each run that same object.
import type { ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { CallClass, Preview, ToolDeclaration } from "../../jig-core/src/contract.ts";
import type { EngineTool, JsonSchema } from "../../jig-core/src/kit/tools.ts";
import { gitSettings } from "./config.ts";
import { checkParams } from "./params.ts";
import type { ActionTable } from "./params.ts";
import { checkSeen, checkUnchanged, toResult } from "./previews.ts";
import type { Call, Planned } from "./previews.ts";
import { setWorkingDirectory } from "./repo.ts";

type Input = Readonly<Record<string, unknown>>;

interface ToolSpec {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    promptGuidelines?: string[];
    parameters: TSchema;
    table: ActionTable;
    /** Where an action acts and whether it reads or writes. Depends on the action, and for a few on the operation. */
    classify(input: Input): CallClass | undefined;
    /** Checks a call and works out what it would do. Reads state, changes nothing. */
    plan(params: Input, call: Call): Promise<Planned>;
}

export interface JigTool {
    definition: ToolDefinition;
    declaration: ToolDeclaration;
}

/** What an `EngineTool` needs beyond a `ToolSpec`: how its calls run, and whether it works on the folder of the call. */
interface EngineSpec extends ToolSpec {
    /** Calls run one at a time and in order: a push must land before the pull request that needs it. */
    sequential: boolean;
    /** The tool works on the folder the call is made in, so an agent with no such folder gives it a `dir` parameter. */
    usesFolder: boolean;
}

export function buildTool(spec: ToolSpec): JigTool {
    const definition: ToolDefinition = {
        name: spec.name,
        label: spec.label,
        description: spec.description,
        promptSnippet: spec.promptSnippet,
        promptGuidelines: spec.promptGuidelines,
        parameters: spec.parameters,
        // Calls run one at a time and in order: a push must be done before the pull request that needs it is opened.
        executionMode: "sequential",
        async execute(
            toolCallId: string,
            params: unknown,
            signal: AbortSignal | undefined,
            _onUpdate: unknown,
            ctx: ExtensionToolContext,
        ) {
            setWorkingDirectory(ctx.cwd);
            const input = params as Input;
            const action = checkParams(spec.name, spec.table, input);
            const planned = await spec.plan(input, { toolCallId, signal, settings: gitSettings() });
            checkUnchanged(toolCallId, planned, `${spec.name} ${action}`);
            return toResult(toolCallId, await planned.run());
        },
    };
    const declaration: ToolDeclaration = {
        tool: spec.name,
        plugin: "jig-git",
        classify: spec.classify,
        async preview(input: Input, signal: AbortSignal): Promise<Preview> {
            checkParams(spec.name, spec.table, input);
            return (await spec.plan(input, { toolCallId: "", signal, settings: gitSettings() })).preview;
        },
    };
    return { definition, declaration };
}

/**
 * The tool as one `EngineTool`. It does what `buildTool` does, with two differences: the folder is `call.cwd` (or the `cwd` that `preview`
 * is handed) and goes to every lookup of a repository, and the approved preview is `call.seen`. The result's `facts` are for the record.
 */
export function buildEngineTool(spec: EngineSpec): EngineTool {
    return {
        tool: spec.name,
        plugin: "jig-git",
        label: spec.label,
        description: spec.description,
        promptSnippet: spec.promptSnippet,
        ...(spec.promptGuidelines === undefined ? {} : { promptGuidelines: spec.promptGuidelines }),
        // A TypeBox schema is a JSON Schema object.
        input: spec.parameters as JsonSchema,
        sequential: spec.sequential,
        usesFolder: spec.usesFolder,
        classify: spec.classify,
        async preview(input, signal, cwd) {
            checkParams(spec.name, spec.table, input);
            return (await spec.plan(input, { toolCallId: "", signal, settings: gitSettings(), cwd })).preview;
        },
        async execute(input, call) {
            const action = checkParams(spec.name, spec.table, input);
            const planned = await spec.plan(input, {
                toolCallId: call.callId,
                signal: call.signal,
                settings: gitSettings(),
                cwd: call.cwd,
            });
            checkSeen(call.seen, planned, `${spec.name} ${action}`);
            const reply = await planned.run();
            return {
                text: reply.text,
                ...(reply.details === undefined ? {} : { data: reply.details }),
                ...(reply.facts === undefined ? {} : { facts: reply.facts }),
            };
        },
    };
}

/** A class for a read or a write at one place. */
export function at(
    action: string,
    environment: "local" | "external",
    effect: "read" | "write",
    more: Partial<CallClass> = {},
): CallClass {
    return { action, environment, effect, ...more };
}

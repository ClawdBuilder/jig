// The MCP side of the gateway: the server that an agent talks to. `createServerFactory` gives the function that `serveStdio` calls for each connection
// (or for a short probe of what revision a server speaks), so it may run more than once in a process; each server it makes offers the same tools
// and hands every call to the one runtime of the process.
//
// A tool is registered with its schema as it is listed (`tool-list.ts`), through the SDK's `fromJsonSchema`, so the SDK checks the input before
// the handler runs. A call that the SDK rejects (a wrong action, a property the schema does not have) therefore never reaches the engine and
// leaves no record line. The result is the text the engine returned after it cleaned it, as one text block; `structuredContent` is not sent.
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult, JsonSchemaType, ServerContext } from "@modelcontextprotocol/server";
import { callIdOf, clientOf } from "./host.ts";
import type { CallOrigin, CallResult, GatewayRuntime } from "./runtime.ts";

/** What the server tells an agent about itself: what it does with a call, and, when it applies, that no settings were found. */
export function instructionsOf(runtime: GatewayRuntime): string {
    const lines = [
        "Jig decides every call of this server. Reads run. A call that needs the user's approval is refused here, because this server has no screen to ask on.",
        "Call jig with the action status to see what was decided lately.",
    ];
    if (runtime.settingsNote !== undefined) lines.push(runtime.settingsNote);
    return lines.join(" ");
}

/** Progress notices of a call, or undefined when the request did not ask for them with a progress token. */
function progressFor(ctx: ServerContext): ((text: string) => void) | undefined {
    const token = ctx.mcpReq._meta?.progressToken;
    if (typeof token !== "string" && typeof token !== "number") return undefined;
    let count = 0;
    return (text) => {
        count += 1;
        // A notice that cannot be sent must not fail the call: the connection may have gone.
        ctx.mcpReq
            .notify({
                method: "notifications/progress",
                params: { progressToken: token, progress: count, message: text },
            })
            .catch(() => undefined);
    };
}

/** What the request says about its call: the agent, the call's id, the cancel switch and, when asked for, the progress. */
function originOf(server: McpServer, ctx: ServerContext): CallOrigin {
    const progress = progressFor(ctx);
    return {
        agent: clientOf(ctx.mcpReq.envelope, server.server.getClientVersion()),
        callId: callIdOf(ctx.mcpReq._meta),
        signal: ctx.mcpReq.signal,
        ...(progress === undefined ? {} : { progress }),
    };
}

/** The arguments of a call as an object. The SDK has checked them against the schema, which is an object, so anything else is an empty call. */
function objectOf(args: unknown): Record<string, unknown> {
    return typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
}

function toolResult(result: CallResult): CallToolResult {
    return { content: [{ type: "text", text: result.text }], ...(result.isError ? { isError: true } : {}) };
}

/** The function `serveStdio` calls to make a server. `version` is what the server says its own version is. */
export function createServerFactory(runtime: GatewayRuntime, version: string): () => McpServer {
    return () => {
        const server = new McpServer({ name: "jig", version }, { instructions: instructionsOf(runtime) });
        for (const entry of runtime.entries) {
            // No read-only mark and no other annotation: every tool of the gateway mixes reads with calls that are refused, and Claude Code's own
            // prompt is answered by an allow rule that `jig setup` offers (design 5.2).
            server.registerTool(
                entry.name,
                {
                    title: entry.title,
                    description: entry.description,
                    inputSchema: fromJsonSchema(entry.inputSchema as JsonSchemaType),
                },
                async (args, ctx) => toolResult(await runtime.call(entry.name, objectOf(args), originOf(server, ctx))),
            );
        }
        return server;
    };
}

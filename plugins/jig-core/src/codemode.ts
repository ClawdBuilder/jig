// Codemode is Pi's script runner. A script with only tool calls is a local read: every nested call is classified and gated
// as itself. A script that can reach `models` (classifiers and image models on the session's credentials), or the escape
// hatches below, is an external write and asks. The check reads text, so it is conservative and falls back to asking.
import type { CallClass, GateCall, GateVerdict } from "./contract.ts";

/** Whole words that mean a script can leave the tool sandbox or reach a model on the session's credentials. */
const RISKY = /\b(?:models|globalThis|eval|Function|constructor|Reflect|import|this|self|global)\b/;

export function classifyCodemode(input: Readonly<Record<string, unknown>>): CallClass | undefined {
    if (typeof input.code !== "string") return undefined;
    if (RISKY.test(input.code)) return { environment: "external", effect: "write", atLeast: "ask" };
    return { environment: "local", effect: "read" };
}

/** The reason the dialog shows for a script that is not a plain read. */
export function codemodeAsk(call: GateCall): GateVerdict | undefined {
    if (call.tool !== "codemode") return undefined;
    if (typeof call.input.code !== "string") return { decision: "ask", reason: "the script could not be read: ask" };
    if (!RISKY.test(call.input.code)) return undefined;
    return { decision: "ask", reason: "the script can call outside models: ask" };
}

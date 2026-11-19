// Codemode is Pi's script runner. A script with only tool calls is a local read: every nested call is classified and gated
// as itself. A script that can reach `models` (classifiers and image models on the session's credentials), or the escape
// hatches below, is an external write and asks. The check reads text, so it is conservative and falls back to asking.
import type { CallClass, GateCall, GateVerdict } from "./contract.ts";

/** Whole words that mean a script can leave the tool sandbox or reach a model on the session's credentials. */
export const RISKY_WORDS = [
    "models",
    "globalThis",
    "eval",
    "Function",
    "constructor",
    "Reflect",
    "import",
    "this",
    "self",
    "global",
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
    "__lookupGetter__",
    "setPrototypeOf",
    "getPrototypeOf",
    "defineProperty",
    "prototype",
    "__proto__",
] as const;

const WORDS = new RegExp(`\\b(?:${RISKY_WORDS.join("|")})\\b`);

/** Backslash and u: an escape that can spell a word above without writing it (`\u006dodels`). Nothing is decoded. */
const ESCAPE = /\\u/;

/** A computed member access whose index is not a number or one plain string literal; it can build a name at run time. */
const COMPUTED =
    /(?:[A-Za-z_$][\w$]*|\)|\])\[\s*(?!(?:\d+(?:\.\d+)?|0x[0-9a-fA-F]+)\s*\]|(?:'[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`$\\]*(?:\\.[^`$\\]*)*`)\s*\])/;

/** Why a script asks: a risky word or a computed access (it may reach models), else a `\u` escape alone, else it does not. */
function whyAsk(code: string): "models" | "escape" | undefined {
    if (WORDS.test(code) || COMPUTED.test(code)) return "models";
    return ESCAPE.test(code) ? "escape" : undefined;
}

export function classifyCodemode(input: Readonly<Record<string, unknown>>): CallClass | undefined {
    if (typeof input.code !== "string") return undefined;
    if (whyAsk(input.code) !== undefined) return { environment: "external", effect: "write", atLeast: "ask" };
    return { environment: "local", effect: "read" };
}

/** The reason the dialog shows for a script that is not a plain read. */
export function codemodeAsk(call: GateCall): GateVerdict | undefined {
    if (call.tool !== "codemode") return undefined;
    if (typeof call.input.code !== "string") return { decision: "ask", reason: "the script could not be read: ask" };
    const why = whyAsk(call.input.code);
    if (why === undefined) return undefined;
    const reason =
        why === "escape" ? "the script writes an escaped name: ask" : "the script can call outside models: ask";
    return { decision: "ask", reason };
}

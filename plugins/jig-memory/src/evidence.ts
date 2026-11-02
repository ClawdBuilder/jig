// Tool results while a ticket is active, kept as evidence. Each result is one file in evidence/, its text clipped to
// 8 KB, and one line in evidence/index.md, so the agent can grep the index before it queries again. The text is the one
// the model saw: jig-core masked and redacted it, because it loads before this plugin.
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { clipBytes } from "./clip.ts";
import { createFile, FILE_MODE, FOLDER_MODE, readText, stampOf, ticketPaths } from "./store.ts";

/** Bytes kept of one result. */
export const EVIDENCE_LIMIT = 8 * 1024;
const CLIP_NOTE = "\n[clipped: the rest of this result is not kept]\n";

// Pi's file tools read and change the repository's own files. They are not evidence of the ticket, and the agent can
// read those files again whenever it needs them.
const FILE_TOOLS: ReadonlySet<string> = new Set(["read", "ls", "find", "grep", "write", "edit"]);

export function isFileTool(tool: string): boolean {
    return FILE_TOOLS.has(tool);
}

export interface EvidenceCall {
    tool: string;
    /** The call's input. Only its `action` is kept: any other argument may hold a secret. */
    input: Readonly<Record<string, unknown>>;
    /** The result's text, as the model saw it. */
    text: string;
}

/** Saves one result as evidence and returns the index line it added. */
export function saveEvidence(folder: string, key: string, call: EvidenceCall, now: Date = new Date()): string {
    const paths = ticketPaths(folder, key);
    const tool = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(call.tool) ? call.tool : "unnamed";
    const action = actionOf(call.input.action);
    const stem = [stampOf(now), slug(tool), action === undefined ? "" : slug(action), randomBytes(3).toString("hex")]
        .filter((part) => part !== "")
        .join("-");
    const name = `${stem}.txt`;
    mkdirSync(paths.evidence, { recursive: true, mode: FOLDER_MODE });
    if (!createFile(path.join(paths.evidence, name), clipBytes(call.text, EVIDENCE_LIMIT, CLIP_NOTE))) {
        throw new Error(`${name} already exists`);
    }
    const line = `- ${now.toISOString()} | ${tool} | ${action ?? "-"} | ${name}`;
    appendFileSync(paths.index, `${line}\n`, { mode: FILE_MODE });
    return line;
}

/** Bytes of pasted text kept in one file. More is refused, not cut: a run's output cut short is worse than none. Under
 *  jig-core's cap on a result, which the text passes through on its way here. */
export const PASTED_LIMIT = 48 * 1024;
/** A label: a few words of letters, digits, spaces, `-` and `_`. */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;

/** Why a label cannot be used, or undefined when it can. */
export function labelProblem(label: string): string | undefined {
    return LABEL.test(label)
        ? undefined
        : "label: 1 to 40 letters, digits, spaces, - or _, starting with a letter or digit, such as batch-3-output";
}

/** Why a pasted text cannot be saved, or undefined when it can. */
export function pastedProblem(text: string): string | undefined {
    if (text.trim() === "") return "text: empty; paste the output to save";
    const bytes = Buffer.byteLength(text);
    if (bytes > PASTED_LIMIT) {
        return `text: ${bytes} bytes; at most ${PASTED_LIMIT}. Save it in parts, each with its own label`;
    }
    return undefined;
}

/**
 * Saves text the user pasted, such as the output of a run they did themselves, as evidence: one file named by the time
 * and the label, and one index line, `- <time> | pasted | <label> | <file>`. The caller passes the text as jig-core left
 * it: masked, with secrets removed. Returns the file name.
 */
export function savePasted(folder: string, key: string, label: string, text: string, now: Date = new Date()): string {
    const problem = labelProblem(label) ?? pastedProblem(text);
    if (problem !== undefined) throw new TypeError(problem);
    const paths = ticketPaths(folder, key);
    const name = `${[stampOf(now), "pasted", slug(label), randomBytes(3).toString("hex")].join("-")}.txt`;
    mkdirSync(paths.evidence, { recursive: true, mode: FOLDER_MODE });
    if (!createFile(path.join(paths.evidence, name), text.endsWith("\n") ? text : `${text}\n`)) {
        throw new Error(`${name} already exists`);
    }
    appendFileSync(paths.index, `- ${now.toISOString()} | pasted | ${slug(label)} | ${name}\n`, { mode: FILE_MODE });
    return name;
}

/** Results saved for the ticket: the lines of evidence/index.md. */
export function indexCount(folder: string, key: string): number {
    return readText(ticketPaths(folder, key).index)
        .split("\n")
        .filter((line) => line.startsWith("- ")).length;
}

/** The action of a call when it is a short word of letters, `-` or `_`. Anything else, such as a token typed into the
 *  field, is not stored: a secret rarely looks like a word. */
function actionOf(value: unknown): string | undefined {
    return typeof value === "string" && /^[A-Za-z][A-Za-z_-]{0,31}$/.test(value) ? value : undefined;
}

const slug = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

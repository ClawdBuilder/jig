// One call's arguments and result, from Pi's own session file. The record keeps the decision, the duration and the facts,
// never the text; Pi's file keeps the text, after jig-core masked it at `tool_result`, so what is on disk is what may be
// shown. Only the selected session's file is read, only when the page asks for one call, and the answer is bounded.
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

/** The most of a call's arguments or result that is sent to the page. */
export const MAX_DETAIL_CHARS = 20_000;
/** A session file larger than this is not read: a call detail is not worth half a gigabyte. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
/** How many files the search looks at, so a huge sessions folder answers promptly. */
const MAX_FILES = 5_000;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

export interface CallDetail {
    found: true;
    /** The arguments Pi kept for the call, when its file has them. */
    arguments?: unknown;
    /** The result text, masked where jig-core masked it, cut at `MAX_DETAIL_CHARS`. */
    result?: string;
    isError?: boolean;
    truncated?: boolean;
    /** The file's name, so a reader can say where it looked. */
    file: string;
}

export type CallLookup = CallDetail | { found: false; reason: string };

/** The session file whose name holds this session id, newest first, looked for under `dir`. */
function findFile(dir: string, sessionId: string, depth = 0, seen = { files: 0 }): string | undefined {
    if (depth > 6 || seen.files >= MAX_FILES) return undefined;
    let entries: Dirent[];
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return undefined;
    }
    for (const entry of entries) {
        if (seen.files >= MAX_FILES) return undefined;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const found = findFile(full, sessionId, depth + 1, seen);
            if (found !== undefined) return found;
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        seen.files++;
        if (entry.name.includes(sessionId)) return full;
    }
    return undefined;
}

function textOf(content: unknown): string | undefined {
    if (!Array.isArray(content)) return undefined;
    const parts = content.flatMap((part) => {
        if (typeof part !== "object" || part === null) return [];
        const record = part as Record<string, unknown>;
        return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
    });
    return parts.length === 0 ? undefined : parts.join("\n");
}

/** Walks one JSON value for the call's arguments and its result, wherever Pi's format put them. */
function harvest(value: unknown, callId: string, found: { args?: unknown; result?: string; isError?: boolean }): void {
    if (Array.isArray(value)) {
        for (const item of value) harvest(item, callId, found);
        return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record.toolCallId === callId) {
        const text = textOf(record.content);
        if (text !== undefined) {
            found.result = text;
            if (record.isError === true) found.isError = true;
        }
    }
    if (record.type === "toolCall" && record.id === callId) {
        found.args = record.arguments ?? record.input;
    }
    for (const item of Object.values(record)) harvest(item, callId, found);
}

/**
 * The arguments and result of one call, read from the session file Pi wrote. `found: false` with a plain reason when the
 * sessions folder is not known, no file names the session, or the file holds no such call.
 */
export function readCallDetail(sessionsDir: string | undefined, sessionId: string, callId: string): CallLookup {
    if (sessionsDir === undefined || sessionsDir === "")
        return { found: false, reason: "Pi's sessions folder is not known." };
    if (!ID.test(sessionId) || !ID.test(callId)) return { found: false, reason: "That is not a session and call id." };
    const file = findFile(sessionsDir, sessionId);
    if (file === undefined) return { found: false, reason: "Pi's session file was not found." };
    try {
        if (statSync(file).size > MAX_FILE_BYTES)
            return { found: false, reason: "The session file is too large to read here." };
    } catch {
        return { found: false, reason: "Pi's session file could not be read." };
    }
    const found: { args?: unknown; result?: string; isError?: boolean } = {};
    let lines: string[];
    try {
        lines = readFileSync(file, "utf8").split("\n");
    } catch {
        return { found: false, reason: "Pi's session file could not be read." };
    }
    for (const line of lines) {
        if (line === "" || !line.includes(callId)) continue;
        try {
            harvest(JSON.parse(line), callId, found);
        } catch {
            // One broken line is not the call.
        }
        if (found.result !== undefined && found.args !== undefined) break;
    }
    if (found.args === undefined && found.result === undefined) {
        return { found: false, reason: "The session file has no arguments or result for this call." };
    }
    let truncated = false;
    let result = found.result;
    if (result !== undefined && result.length > MAX_DETAIL_CHARS) {
        result = `${result.slice(0, MAX_DETAIL_CHARS)}\n… (cut at ${MAX_DETAIL_CHARS} characters)`;
        truncated = true;
    }
    return {
        found: true,
        ...(found.args === undefined ? {} : { arguments: found.args }),
        ...(result === undefined ? {} : { result }),
        ...(found.isError === true ? { isError: true } : {}),
        ...(truncated ? { truncated: true } : {}),
        file: path.basename(file),
    };
}

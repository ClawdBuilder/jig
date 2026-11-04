// One call's arguments and result, read from Pi's session file: only that session's file, only that call, bounded, and the
// text is what jig-core masked before Pi wrote it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { MAX_DETAIL_CHARS, readCallDetail } from "../src/session-file.ts";

let dir: string;
const SESSION = "01920000-0000-7000-8000-000000000001";
const CALL = "call_abc123";

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "jig-lens-session-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeSession(lines: unknown[], folder = "project"): string {
    const into = path.join(dir, folder);
    mkdirSync(into, { recursive: true });
    const file = path.join(into, `2026-11-04T10-00-00_${SESSION}.jsonl`);
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n"));
    return file;
}

const call = (id: string, args: unknown) => ({
    type: "message",
    message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: args }] },
});
const result = (id: string, text: string, isError = false) => ({
    type: "message",
    message: { role: "toolResult", toolCallId: id, isError, content: [{ type: "text", text }] },
});

describe("one call from Pi's session file", () => {
    test("finds the call's arguments and its result in the file whose name holds the session", () => {
        writeSession([call(CALL, { command: "ls -a" }), result(CALL, "a.txt\nb.txt")]);
        const found = readCallDetail(dir, SESSION, CALL);
        assert.equal(found.found, true);
        if (found.found !== true) return;
        assert.deepEqual(found.arguments, { command: "ls -a" });
        assert.equal(found.result, "a.txt\nb.txt");
        assert.equal(found.isError, undefined);
        assert.match(found.file, new RegExp(SESSION));
    });

    test("says a failed call's result is a failure, and cuts a very long result", () => {
        writeSession([call(CALL, {}), result(CALL, "x".repeat(MAX_DETAIL_CHARS + 10), true)]);
        const found = readCallDetail(dir, SESSION, CALL);
        assert.equal(found.found, true);
        if (found.found !== true) return;
        assert.equal(found.isError, true);
        assert.equal(found.truncated, true);
        assert.match(found.result ?? "", /cut at 20000 characters\)$/);
    });

    test("answers found:false, with a plain reason, when the session or the call is not there", () => {
        assert.equal(readCallDetail(undefined, SESSION, CALL).found, false);
        const missing = readCallDetail(dir, SESSION, CALL);
        assert.equal(missing.found, false);
        if (missing.found === false) assert.match(missing.reason, /not found/);
        writeSession([call(CALL, {})]);
        const other = readCallDetail(dir, SESSION, "call_other");
        assert.equal(other.found, false);
        if (other.found === false) assert.match(other.reason, /no arguments or result/);
    });

    test("refuses ids that could leave the sessions folder", () => {
        const found = readCallDetail(dir, "../../etc/passwd", CALL);
        assert.equal(found.found, false);
        if (found.found === false) assert.match(found.reason, /not a session and call id/);
    });
});

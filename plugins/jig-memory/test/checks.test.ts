import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import {
    addCheck,
    CHECK_TEXT_LIMIT,
    CheckError,
    checksFile,
    closeCheck,
    OPEN_LIMIT,
    openChecks,
    openChecksText,
    readChecks,
} from "../src/checks.ts";
import { ensureTicket } from "../src/store.ts";
import { tempFolder } from "./support.ts";

const at = new Date("2026-11-02T19:20:00.000Z");

test("a check is added to checks.json, private, in the documented shape", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-123");
    assert.deepEqual(readChecks(folder, "PROJ-123"), [], "no file is no checks");
    const check = addCheck(folder, "PROJ-123", "  re-derive the locations\n before the next batch ", at);
    assert.deepEqual(check, {
        id: 1,
        text: "re-derive the locations before the next batch",
        status: "open",
        openedAt: "2026-11-02T19:20:00.000Z",
    });
    const file = checksFile(folder, "PROJ-123");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { version: 1, checks: [check] });
});

test("closing a check keeps it with its outcome, and the numbers are never reused", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-123");
    addCheck(folder, "PROJ-123", "first", at);
    addCheck(folder, "PROJ-123", "second", at);
    const closed = closeCheck(
        folder,
        "PROJ-123",
        1,
        "done: 12 locations re-derived",
        new Date("2026-11-02T20:00:00.000Z"),
    );
    assert.equal(closed.status, "closed");
    assert.equal(closed.closedAt, "2026-11-02T20:00:00.000Z");
    assert.equal(closed.outcome, "done: 12 locations re-derived");
    assert.deepEqual(
        openChecks(folder, "PROJ-123").map((check) => check.id),
        [2],
    );
    assert.equal(addCheck(folder, "PROJ-123", "third", at).id, 3);
    assert.throws(() => closeCheck(folder, "PROJ-123", 1, "again", at), /closed already/);
    assert.throws(() => closeCheck(folder, "PROJ-123", 9, "x", at), /no check #9/);
});

test("empty or long text, and too many open checks, are refused", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-123");
    assert.throws(() => addCheck(folder, "PROJ-123", "  ", at), CheckError);
    assert.throws(() => addCheck(folder, "PROJ-123", "x".repeat(CHECK_TEXT_LIMIT + 1), at), /at most 200/);
    for (let n = 0; n < OPEN_LIMIT; n++) addCheck(folder, "PROJ-123", `check ${n}`, at);
    assert.throws(() => addCheck(folder, "PROJ-123", "one more", at), /20 checks are open already/);
});

test("a checks.json that is not one is an error, and is never overwritten", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-123");
    writeFileSync(checksFile(folder, "PROJ-123"), "{ not json");
    assert.throws(() => readChecks(folder, "PROJ-123"), /is not JSON: fix or remove it/);
    assert.throws(() => addCheck(folder, "PROJ-123", "x", at), CheckError);
    assert.equal(readFileSync(checksFile(folder, "PROJ-123"), "utf8"), "{ not json");
});

test("the open checks are worded with the rule for the next command", () => {
    assert.equal(openChecksText("PROJ-123", []), undefined);
    const text = openChecksText("PROJ-123", [
        { id: 2, text: "re-derive the locations", status: "open", openedAt: at.toISOString() },
    ]);
    assert.equal(
        text,
        "[ticket PROJ-123] 1 open check:\n#2 re-derive the locations\nBefore you hand the user a command for the next step, close each check (ticket close_check) or say plainly that it is still open.",
    );
});

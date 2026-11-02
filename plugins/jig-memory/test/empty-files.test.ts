import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { EMPTY_SHOWN, emptyFilesText, findEmptyFiles } from "../src/empty-files.ts";
import { localDate } from "../src/notes.ts";
import { ensureTicket, ticketPaths } from "../src/store.ts";
import { tempFolder } from "./support.ts";

const DAY = 24 * 60 * 60 * 1000;

test("empty files changed in the last 7 days are found, in folders too, newest first", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-123");
    const dir = ticketPaths(folder, "PROJ-123").dir;
    const now = new Date();
    mkdirSync(path.join(dir, "remove-services"));
    writeFileSync(path.join(dir, "remove-services", "data.csv"), "");
    writeFileSync(path.join(dir, "ids.csv"), "");
    utimesSync(path.join(dir, "ids.csv"), new Date(now.getTime() - DAY), new Date(now.getTime() - DAY));
    writeFileSync(path.join(dir, "old.csv"), "");
    utimesSync(path.join(dir, "old.csv"), new Date(now.getTime() - 8 * DAY), new Date(now.getTime() - 8 * DAY));
    writeFileSync(path.join(dir, "full.csv"), "id\n1\n");

    const found = findEmptyFiles(dir, now);
    assert.deepEqual(
        found.shown.map((entry) => entry.file),
        ["remove-services/data.csv", "ids.csv"],
    );
    assert.equal(found.total, 2);
});

test("evidence/, temporary files and links are not reported", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-123");
    const paths = ticketPaths(folder, "PROJ-123");
    writeFileSync(path.join(paths.evidence, "2026-11-02T10-00-00.000Z-bash-1a2b3c.txt"), "");
    writeFileSync(path.join(paths.dir, "notes.md.1a2b.tmp"), "");
    writeFileSync(path.join(folder, "elsewhere.csv"), "");
    symlinkSync(path.join(folder, "elsewhere.csv"), path.join(paths.dir, "link.csv"));
    assert.equal(findEmptyFiles(paths.dir, new Date()).total, 0);
});

test("the notice names the files with their time, caps the list and counts the rest", (t) => {
    const folder = tempFolder(t);
    const dir = path.join(folder, "PROJ-123");
    mkdirSync(dir);
    for (let n = 0; n < EMPTY_SHOWN + 2; n++)
        writeFileSync(path.join(dir, `part-${String(n).padStart(2, "0")}.csv`), "");
    const now = new Date();
    const text = emptyFilesText("PROJ-123", findEmptyFiles(dir, now), now) ?? "";
    assert.match(
        text,
        /^\[ticket PROJ-123\] These files are empty, possibly cut short by a crash or an unfinished write: part-\d\d\.csv \(changed \d\d:\d\d\), /,
    );
    assert.match(text, /, and 2 more\. Check before using them\.$/);
    assert.equal(text.match(/\(changed /g)?.length, EMPTY_SHOWN);
});

test("a file changed on an earlier day shows its date; nothing empty is no notice", () => {
    const now = new Date(2026, 10, 2, 12, 0);
    const changed = new Date(2026, 10, 1, 19, 15);
    const text = emptyFilesText("PROJ-123", { shown: [{ file: "data.csv", changed }], total: 1 }, now);
    assert.equal(
        text,
        `[ticket PROJ-123] This file is empty, possibly cut short by a crash or an unfinished write: data.csv (changed ${localDate(changed)} 19:15). Check before using them.`,
    );
    assert.equal(emptyFilesText("PROJ-123", { shown: [], total: 0 }, now), undefined);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTES_IN_MESSAGE, notesMessage, REMIND_AFTER, reminderText } from "../src/message.ts";

const base = { key: "ACME-1", folder: "/data/tickets/ACME-1", lead: "Active.", today: "2026-11-02" };

test("the notes message names the ticket, its folder, the files and today's date, then the notes", () => {
    assert.equal(
        notesMessage({ ...base, notes: "# ACME-1\n\n## Now\nStatus: new\n" }),
        "[ticket ACME-1] Active. Folder: /data/tickets/ACME-1/ (notes.md, evidence/index.md). Today is 2026-11-02.\n\n# ACME-1\n\n## Now\nStatus: new\n",
    );
});

test("the open checks follow the notes when there are any", () => {
    const checks = "[ticket ACME-1] 1 open check:\n#1 re-derive the locations";
    assert.match(
        notesMessage({ ...base, notes: "# ACME-1\n", checks }),
        /# ACME-1\n\n\n\[ticket ACME-1\] 1 open check:\n#1 re-derive/,
    );
});

test("empty notes are said to be empty", () => {
    assert.match(notesMessage({ ...base, notes: "  \n" }), /\n\n\(notes\.md is empty\)$/);
});

test("notes longer than 16 KB are cut, with a note that says where the rest is", () => {
    const message = notesMessage({ ...base, notes: "line of decisions\n".repeat(2000) });
    assert.ok(Buffer.byteLength(message) <= NOTES_IN_MESSAGE + 200, `${Buffer.byteLength(message)} bytes`);
    assert.match(message, /\n\[\.\.\. cut at 16 KB; read notes\.md for the rest\]$/);
});

test("the reminder names the count, the notes file, what to update and today's date", () => {
    const text = reminderText("ACME-1", "/data/tickets/ACME-1/notes.md", "2026-11-02");
    assert.equal(REMIND_AFTER, 15);
    assert.match(
        text,
        /^\[ticket ACME-1\] 15 tool results since the ## Now block of notes\.md last changed: update it in \/data\/tickets\/ACME-1\/notes\.md \(status, next step, open questions\)\. Today is 2026-11-02\.$/,
    );
});

test("the reminder says how many checks are open", () => {
    assert.match(
        reminderText("ACME-1", "/n.md", "2026-11-02", 1),
        /Today is 2026-11-02\. 1 check is still open \(ticket list-checks\)\.$/,
    );
    assert.match(reminderText("ACME-1", "/n.md", "2026-11-02", 3), / 3 checks are still open /);
});

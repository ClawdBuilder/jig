// The generic recall script runs on any folder and prints aggregates only. Invented notes cover it without real data: one
// note names another ticket, one does not, and the score must find the named one without printing a key.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tempFolder } from "./support.ts";
import { ticketPaths } from "../src/store.ts";

const SCRIPT = path.resolve(import.meta.dirname, "..", "scripts", "recall-eval.mjs");

function writeNote(folder: string, key: string, text: string): void {
    mkdirSync(ticketPaths(folder, key).dir, { recursive: true });
    writeFileSync(ticketPaths(folder, key).notes, text);
}

test("hand labels replace derived links, and top 3 is not capped by the display budget", (t) => {
    const folder = tempFolder(t);
    for (const key of ["PROJ-1", "PROJ-2", "PROJ-3"]) {
        writeNote(folder, key, `# ${key}\n\n## Now\nStatus: OrderService\n\n## Decisions\n`);
    }
    const labels = path.join(folder, "labels.json");
    writeFileSync(
        labels,
        JSON.stringify({
            pairs: [
                ["PROJ-1", "PROJ-2"],
                ["PROJ-2", "PROJ-3"],
            ],
        }),
    );
    const stdout = execFileSync(process.execPath, [SCRIPT, "--folder", folder, "--labels", labels, "--top", "3"], {
        encoding: "utf8",
    });
    const result = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(result.labelled, true);
    assert.equal(result.pairs, 2);
    assert.equal(result.cases, 3);
    assert.equal(result.top, 3);
    assert.equal(result.maxNotes === undefined, true, "the result has no capped maxNotes");
    assert.equal(stdout.includes("PROJ-1"), false);
});

test("the script finds an invented linked ticket from notes, and prints no key", (t) => {
    const folder = tempFolder(t);
    writeNote(
        folder,
        "PROJ-1",
        "# PROJ-1\n\n## Now\nStatus: OrderService throws NullPointerException\n\n## Decisions\nSee PROJ-2 for the mapper fix.\n",
    );
    writeNote(
        folder,
        "PROJ-2",
        "# PROJ-2\n\n## Now\nStatus: OrderService returns a null customer\n\n## Decisions\nCheck for null.\n",
    );
    writeNote(folder, "PROJ-3", "# PROJ-3\n\n## Now\nStatus: a footer is the wrong colour\n\n## Decisions\n");
    const stdout = execFileSync(process.execPath, [SCRIPT, "--folder", folder, "--mode", "notes"], {
        encoding: "utf8",
    });
    const result = JSON.parse(stdout) as Record<string, unknown>;
    assert.equal(result.mode, "notes");
    assert.equal(result.tickets, 3);
    assert.equal(result.cases, 1);
    assert.equal(result.hits, 1);
    assert.equal(result.recallAt3, 1);
    assert.equal(stdout.includes("PROJ-1"), false);
    assert.equal(stdout.includes("NullPointerException"), false);
    const cards = JSON.parse(
        execFileSync(process.execPath, [SCRIPT, "--folder", folder, "--mode", "cards"], { encoding: "utf8" }),
    ) as Record<string, unknown>;
    assert.equal(cards.hits, 0);
});

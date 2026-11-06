#!/usr/bin/env node
// Measures recall on a real or invented tickets folder without printing any content: only counts, rates and booleans.
//
// A real link is a ticket whose notes.md names another ticket in the folder. The evaluation removes every ticket key from
// the query and from both documents before searching, so a shared key cannot produce the answer. The query is the first
// lines of the note, an approximation of the message that starts a real ticket. It reports recall@3 over the links and how
// often a ticket with no link still gets a top-3 hit above the minimum score (the noise an agent would pay for).
//
// Usage: node recall-eval.mjs --folder <tickets> [--mode notes|cards|both] [--min-score 2] [--max 3]
// Prints one JSON object and nothing else. Errors print {"error":true} and exit 1; a path, key or note text is never printed.
import { readdirSync, statSync } from "node:fs";
import { entryOf } from "../src/cards.ts";
import { RECALL_DEFAULTS } from "../src/config.ts";
import { noteEntryOf } from "../src/notes-index.ts";
import { buildQuery, recall } from "../src/recall.ts";
import { isSafeKey, readText, ticketPaths } from "../src/store.ts";

function args(argv) {
    const out = {
        folder: undefined,
        mode: "notes",
        minScore: RECALL_DEFAULTS.minScore,
        max: RECALL_DEFAULTS.max,
        maxNotes: RECALL_DEFAULTS.maxNotes,
        lines: 25,
    };
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i];
        const value = argv[i + 1];
        if (name === "--folder") out.folder = value;
        else if (name === "--mode") out.mode = value;
        else if (name === "--min-score") out.minScore = Number(value);
        else if (name === "--max") out.max = Number(value);
        else if (name === "--max-notes") out.maxNotes = Number(value);
        else if (name === "--lines") out.lines = Number(value);
        else continue;
        i++;
    }
    return out;
}

const quoteRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The text with every ticket key in the folder taken out, so a shared key cannot be the reason a result came back. */
function redact(text, keys) {
    let out = text;
    for (const key of keys) out = out.split(key).join(" ");
    return out;
}
/** The first meaningful lines of a note: what a message that starts the ticket resembles best. */
function start(text, lines) {
    const kept = [];
    for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        kept.push(line);
        if (kept.length >= lines) break;
    }
    return kept.join("\n");
}
const names = (text, key) => new RegExp(`(?<![A-Za-z0-9])${quoteRegExp(key)}(?![A-Za-z0-9])`).test(text);

function main() {
    const a = args(process.argv.slice(2));
    if (typeof a.folder !== "string" || a.folder === "") throw new Error("no folder");
    const folders = readdirSync(a.folder, { withFileTypes: true }).filter(
        (entry) => entry.isDirectory() && isSafeKey(entry.name),
    );
    const keys = folders.map((entry) => entry.name);
    // A folder with notes is a ticket; a card without notes can still be searched in cards mode.
    const notes = new Map();
    const cards = new Map();
    for (const key of keys) {
        const paths = ticketPaths(a.folder, key);
        try {
            const stat = statSync(paths.notes);
            notes.set(key, { text: readText(paths.notes), stamp: { mtimeMs: stat.mtimeMs, size: stat.size } });
        } catch {
            // No note yet.
        }
        try {
            const stat = statSync(paths.card);
            cards.set(key, { text: readText(paths.card), stamp: { mtimeMs: stat.mtimeMs, size: stat.size } });
        } catch {
            // No card yet.
        }
    }
    // Every link is read before redaction: A names B in A's notes.
    const linked = new Map();
    for (const [key, note] of notes) {
        const found = [...notes.keys()].filter((other) => other !== key && names(note.text, other));
        linked.set(key, found);
    }
    const cardIndex = {};
    for (const [key, card] of cards) {
        const text = redact(card.text, keys);
        const entry = entryOf(key, text, card.stamp);
        cardIndex[key] = entry;
    }
    const noteIndex = {};
    for (const [key, note] of notes) {
        noteIndex[key] = noteEntryOf(key, redact(note.text, keys), note.stamp, undefined);
    }
    const modes = a.mode === "both" ? ["cards", "notes"] : [a.mode];
    const results = [];
    for (const mode of modes) {
        if (mode !== "cards" && mode !== "notes") throw new Error("bad mode");
        let expected = 0;
        let hits = 0;
        let cases = 0;
        let casesFound = 0;
        let noLinkCases = 0;
        let noLinkHits = 0;
        for (const [key, note] of notes) {
            const wanted = linked.get(key) ?? [];
            const query = buildQuery({
                ticket: key,
                text: redact(start(note.text, a.lines), keys),
                pattern: undefined,
            });
            const matches =
                mode === "cards"
                    ? recall(cardIndex, query, { max: a.max, minScore: a.minScore, maxNotes: 0 })
                    : recall({}, query, { max: a.max, minScore: a.minScore, maxNotes: a.maxNotes }, noteIndex);
            const top = matches.slice(0, 3).map((match) => match.ticket);
            if (wanted.length === 0) {
                noLinkCases++;
                if (matches.length > 0) noLinkHits++;
            } else {
                cases++;
                expected += wanted.length;
                const got = wanted.filter((ticket) => top.includes(ticket)).length;
                hits += got;
                if (got > 0) casesFound++;
            }
        }
        results.push({
            mode,
            tickets: keys.length,
            documents: mode === "cards" ? Object.keys(cardIndex).length : Object.keys(noteIndex).length,
            linkedCases: cases,
            expectedLinks: expected,
            hits,
            recallAt3: expected === 0 ? null : Math.round((hits / expected) * 1000) / 1000,
            casesFound,
            noLinkCases,
            noLinkHits,
            noise: noLinkCases === 0 ? null : Math.round((noLinkHits / noLinkCases) * 1000) / 1000,
            minScore: a.minScore,
            max: a.max,
            maxNotes: a.maxNotes,
            queryLines: a.lines,
        });
    }
    return a.mode === "both" ? { modes: results } : results[0];
}

try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
} catch {
    process.stdout.write('{"error":true}\n');
    process.exitCode = 1;
}

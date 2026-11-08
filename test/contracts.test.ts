// The published front-end contract must do what jig-session's engine does, input for input, and the palette file must be
// exactly what jig-theme's theme files produce.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as js from "../contracts/requests.js";
import * as ts from "../plugins/jig-session/src/requests.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORPUS: string[] = [
    JSON.stringify({ schema: 1, id: "a-1", tools: { read: true }, skills: { "a:b": false }, reload: true }),
    JSON.stringify({ schema: 1 }),
    "not json",
    "[]",
    JSON.stringify({ schema: 2 }),
    JSON.stringify({ schema: 1, id: "bad id!" }),
    JSON.stringify({ schema: 1, tools: { "bad name!": true } }),
    JSON.stringify({ schema: 1, tools: { read: "yes" } }),
    JSON.stringify({ schema: 1, skills: [] }),
    JSON.stringify({ schema: 1, reload: "yes" }),
    JSON.stringify({ schema: 1, unknown: { private: "ignored" } }),
    JSON.stringify({ schema: 1, id: "x".repeat(101), tools: { ["x".repeat(129)]: true } }),
];

test("the published request module and jig-session parse the same corpus", () => {
    for (const text of CORPUS) {
        assert.deepEqual(js.parseRequest(text), ts.parseRequest(text), text);
    }
});

function files(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of readdirSync(dir)) {
        const file = path.join(dir, name);
        if (statSync(file).isFile()) out[name] = readFileSync(file, "utf8");
    }
    return out;
}

test("takeRequest and sweepRequests agree on size, stray, live, old and keep files", (t) => {
    const base = mkdtempSync(path.join(tmpdir(), "jig-contracts-"));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    for (const which of ["js", "ts"]) {
        const dir = path.join(base, which);
        mkdirSync(dir);
        writeFileSync(path.join(dir, "small.json"), '{"schema":1}');
        writeFileSync(path.join(dir, "large.json"), "x".repeat(70_000));
        const take = which === "js" ? js.takeRequest : ts.takeRequest;
        assert.equal(take(path.join(dir, "small.json")), '{"schema":1}');
        assert.equal(take(path.join(dir, "large.json")), null);
        assert.equal(take(path.join(dir, "missing.json")), undefined);
        const sweep = path.join(dir, "sweep");
        mkdirSync(sweep);
        writeFileSync(path.join(sweep, "dead.json"), "{}");
        writeFileSync(path.join(sweep, "live.json"), "{}");
        writeFileSync(path.join(sweep, "keep.json"), "{}");
        writeFileSync(path.join(sweep, "old.tmp"), "x");
        const old = new Date(Date.now() - 120_000);
        utimesSync(path.join(sweep, "old.tmp"), old, old);
        const removed = (which === "js" ? js.sweepRequests : ts.sweepRequests)(
            sweep,
            (name) => name === "live.json",
            "keep.json",
        );
        assert.deepEqual(removed.sort(), ["dead.json", "old.tmp"]);
        assert.deepEqual(files(sweep), { "keep.json": "{}", "live.json": "{}" });
    }
});

test("the palette contract is generated from jig-theme's files", () => {
    const themes = path.join(ROOT, "plugins/jig-theme/themes");
    const expected = Object.fromEntries(
        readdirSync(themes).sort().map((name) => [name, JSON.parse(readFileSync(path.join(themes, name), "utf8"))]),
    );
    assert.deepEqual(JSON.parse(readFileSync(path.join(ROOT, "contracts/palettes.json"), "utf8")), expected);
});

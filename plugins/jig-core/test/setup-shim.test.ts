// The `jig` command that `jig setup` writes, and what it does with one that already runs another home: no child process,
// a temporary home holding this checkout, and a setup that answers its question itself.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { bootstrap, shimTarget, shimText } from "../src/cli/bootstrap.ts";
import type { BootstrapUi } from "../src/cli/bootstrap.ts";
import { homeCommand } from "../src/cli/home.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

let root: string;
let home: string;
let jig: string;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-shim-"));
    home = path.join(root, "home");
    jig = path.join(home, ".jig");
    for (const folder of [home, jig]) mkdirSync(folder, { recursive: true });
    // The home's Jig, as `pi install` leaves it: a copy of this checkout, linked so one test tree is enough.
    const folder = path.join(jig, "npm", "node_modules", "@clawdbuilder", "jig");
    mkdirSync(path.dirname(folder), { recursive: true });
    symlinkSync(ROOT, folder, "dir");
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("the shim a setup writes", () => {
    const person = "/home/someone";
    /** The command Jig's own `pi install` leaves in the home. */
    const npm = (home: string): string => `${home}/npm/node_modules/@clawdbuilder/jig/bin/jig.mjs`;

    test("is read back as the home and the program it records", () => {
        assert.deepEqual(shimTarget(shimText(`${person}/.jig`, person, npm(`${person}/.jig`)), person), {
            command: npm(`${person}/.jig`),
            home: `${person}/.jig`,
        });
        // A path can hold what the shell would otherwise read: quotes, a backslash, a backtick and a dollar.
        const odd = `/homes/a "quoted" back\\slash \`tick $dollar`;
        assert.equal(shimTarget(shimText(odd, person, npm(odd)), person)?.home, odd);
        const folder = "/work/a folder/it's here";
        assert.deepEqual(shimTarget(shimText("/homes/a", person, `${folder}/bin/jig.mjs`), person), {
            command: `${folder}/bin/jig.mjs`,
            home: `${person}/.jig`,
            folder,
        });
        assert.equal(shimTarget("#!/bin/sh\necho mine\n", person), undefined, "somebody else's jig");
    });
});

describe("a setup with another home's jig command", () => {
    /** A home that holds this checkout as `pi install` leaves it, so the shim needs no install. */
    function homeWithJig(name: string): string {
        const other = path.join(root, name);
        const folder = path.join(other, "npm", "node_modules", "@clawdbuilder", "jig");
        mkdirSync(path.dirname(folder), { recursive: true });
        symlinkSync(ROOT, folder, "dir");
        return other;
    }

    test("asks before replacing it, keeps it on no, and replaces it on yes", async () => {
        const other = homeWithJig("other-home");
        const bin = path.join(root, "ask-bin");
        mkdirSync(bin);
        const shim = path.join(bin, "jig");
        const first = shimText(jig, home, homeCommand(jig));
        for (const answer of [false, true]) {
            writeFileSync(shim, first, { mode: 0o755 });
            const asked: string[] = [];
            const notes: string[] = [];
            const ui: BootstrapUi = {
                notify: (text) => notes.push(text),
                async confirm(title) {
                    asked.push(title);
                    return answer;
                },
            };
            const result = await bootstrap({ home: other, binDir: bin, migrate: "ask", ui, env: { HOME: home } });
            assert.deepEqual(result.problems, []);
            assert.equal(asked.length, 1, "one question, and nothing else asks");
            assert.match(asked[0] as string, /^Replace the jig command at /);
            if (answer) {
                assert.equal(readFileSync(shim, "utf8"), shimText(other, home, homeCommand(other)));
                assert.equal(result.shim, shim, "the command was written");
            } else {
                assert.equal(readFileSync(shim, "utf8"), first, "the command was kept");
                assert.equal(result.shim, undefined);
                assert.match(notes.join("\n"), /so it was left alone/);
            }
        }
    });
});

// What a tool says while its section is missing: the command that sets it up first, then the by-hand route, on one line.
// A plugin whose setup has questions never opens with "edit jig.json" (jira did, and the agent told the person to edit
// the file by hand, though `jig setup jira` would have asked every question).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { notSetUpMessage } from "../src/kit/values.ts";

const PLUGINS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Every `.ts` file under each plugin's `src`, as [relative path, text]. */
function sources(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const walk = (dir: string): void => {
        for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            if (statSync(full).isDirectory()) walk(full);
            else if (name.endsWith(".ts")) out.push([path.relative(PLUGINS, full), readFileSync(full, "utf8")]);
        }
    };
    for (const plugin of readdirSync(PLUGINS)) {
        const src = path.join(PLUGINS, plugin, "src");
        try {
            if (statSync(src).isDirectory()) walk(src);
        } catch {
            // A plugin with no src folder.
        }
    }
    return out;
}

describe("the line for a section that is not set up", () => {
    const input = { section: "orders", plugin: "jig-orders", needs: 'an "orders" section with "services"' };

    test("names the setup command first, in Pi and in a terminal, then the by-hand route and the README", () => {
        const said = notSetUpMessage(input);
        assert.equal(
            said,
            'orders is not set up: ask the person to run /jig setup orders in Pi, or jig setup orders in a terminal; by hand, add an "orders" section with "services" to jig.json (see the jig-orders README)',
        );
        assert.equal(said.includes("\n"), false);
    });

    test("to a person typing a command, it says run, not ask the person", () => {
        assert.match(
            notSetUpMessage({ ...input, reader: "person" }),
            /^orders is not set up: run \/jig setup orders in Pi, or jig setup orders in a terminal; by hand, add/,
        );
    });
});

describe("no plugin opens with a hand edit of jig.json", () => {
    test('a message "is not set up: add ..." or "is not configured: add ..." is only for a plugin with no setup questions', () => {
        // ops registers a summary and no questions yet, so `jig setup ops` has nothing to ask: its message is by hand.
        const noQuestions = new Set(["jig-ops/src/catalog.ts"]);
        const found = sources()
            .filter(([file, text]) => /is not (?:set up|configured): add an? /.test(text) && !noQuestions.has(file))
            .map(([file]) => file);
        assert.deepEqual(found, []);
    });
});

// Every plugin in the package manifest has a feature, so a new plugin cannot silently be missing from the doctor's
// off-plugin line, and the table names the section each plugin registers, so a session knows which sections are off.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FEATURES, offSectionsOf } from "../src/plugin-table.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

test("the feature table covers every plugin in package.json's pi.extensions", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
        pi?: { extensions?: string[] };
    };
    const plugins = (manifest.pi?.extensions ?? [])
        .map((file) => /^\.\/plugins\/([^/]+)\/index\.ts$/.exec(file)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort();
    assert.deepEqual(Object.keys(FEATURES).sort(), plugins);
    for (const [plugin, feature] of Object.entries(FEATURES)) {
        assert.notEqual(feature.feature.trim(), "", plugin);
        assert.match(feature.feature, /^[a-z]+$/, plugin);
    }
});

test("the table lists session and review, and every section a plugin registers", () => {
    assert.equal(FEATURES["jig-session"]?.section, "session");
    assert.equal(FEATURES["jig-review"]?.section, "review");
    for (const [plugin, entry] of Object.entries(FEATURES)) {
        const source = readFileSync(path.join(ROOT, "plugins", plugin, "src", "index.ts"), "utf8");
        const registered = /registerSection\(\s*"([^"]+)"/.exec(source)?.[1];
        assert.equal(entry.section, registered, `${plugin} registers ${registered ?? "no section"}`);
    }
});

test("a section is off when no loaded plugin registered it", () => {
    const off = offSectionsOf(["git", "fake"]);
    assert.equal(off.has("git"), false);
    assert.equal(off.has("fake"), false, "a section the table does not know is never counted");
    assert.deepEqual(
        [...off].sort(),
        Object.values(FEATURES)
            .flatMap((entry) => (entry.section === undefined || entry.section === "git" ? [] : [entry.section]))
            .sort(),
    );
});

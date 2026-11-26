// Every plugin in the package manifest has a feature, so a new plugin cannot silently be missing from the doctor's
// off-plugin line, and the table names the section each plugin registers, so a session knows which sections are off.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FEATURES, offSectionsOf } from "../src/plugin-table.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * The sections a plugin's source registers, read from every file under its `src/`. The call need not be in `index.ts`: a plugin with a
 * connector keeps it in a function that its Pi entry and its connector both call (jig-git, `config.ts`).
 */
function registeredSections(plugin: string): string[] {
    const folder = path.join(ROOT, "plugins", plugin, "src");
    const names = new Set<string>();
    for (const file of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
        if (!file.endsWith(".ts")) continue;
        const source = readFileSync(path.join(folder, file), "utf8");
        for (const match of source.matchAll(/registerSection\(\s*"([^"]+)"/g)) names.add(match[1] as string);
    }
    return [...names];
}

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
        const registered = registeredSections(plugin);
        assert.deepEqual(
            registered,
            entry.section === undefined ? [] : [entry.section],
            `${plugin} registers ${registered.join(", ") || "no section"}`,
        );
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

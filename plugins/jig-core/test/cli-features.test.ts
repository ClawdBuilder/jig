// Every plugin in the package manifest has a feature, so a new plugin cannot silently be missing from the doctor's
// off-plugin lines, and an always-on one cannot be forgotten.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FEATURES } from "../src/cli/headless.ts";

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

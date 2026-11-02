// The package manifest is how Pi finds the plugins: one that is missing simply never loads. Each plugin has an entry file of its own,
// `plugins/<name>/index.ts`, because Pi names an extension after the folder of its entry file: from `src/index.ts` every plugin would
// be shown as `<name>/src`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { extensionLabels } from "../../../test/support/pi-labels.mjs";
import { piHostDir } from "../../../test/support/pi-host-dir.mjs";

const root = path.resolve(import.meta.dirname, "../../..");

const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    pi: { extensions: string[] };
};
/** The plugins that have code to load. */
const plugins = readdirSync(path.join(root, "plugins")).filter((name) =>
    existsSync(path.join(root, "plugins", name, "src", "index.ts")),
);

test("the package manifest lists every plugin that has an entry point, and jig-core first", () => {
    const listed = manifest.pi.extensions.map((entry) => /^\.\/plugins\/([^/]+)\/index\.ts$/.exec(entry)?.[1] ?? entry);
    assert.deepEqual([...listed].sort(), [...plugins].sort());
    // Handlers run in load order, so jig-core's gate and result hook must come before every other plugin's.
    assert.equal(manifest.pi.extensions[0], "./plugins/jig-core/index.ts");
});

test("each entry file only hands on the default export of the plugin's src/index.ts, which stays where it is", () => {
    for (const name of plugins) {
        const code = readFileSync(path.join(root, "plugins", name, "index.ts"), "utf8")
            .split("\n")
            .filter((line) => line.trim() !== "" && !line.startsWith("//"));
        assert.deepEqual(code, ['export { default } from "./src/index.ts";'], name);
    }
});

const hasPi = existsSync(path.join(piHostDir, "dist/modes/interactive/interactive-mode.js"));

test("Pi shows each extension by its plugin's name", {
    skip: hasPi ? false : `no Pi at ${piHostDir} (set PI_HOST_DIR)`,
}, async () => {
    // The source information of a package given to Pi as a local folder, as `get_commands` reports it.
    const extensions = manifest.pi.extensions.map((entry) => {
        const file = path.resolve(root, entry);
        return {
            path: file,
            sourceInfo: { path: file, source: root, scope: "user", origin: "package", baseDir: root },
        };
    });
    const labels = await extensionLabels(piHostDir, extensions);
    assert.deepEqual(
        labels,
        manifest.pi.extensions.map((entry) => /^\.\/plugins\/([^/]+)\//.exec(entry)?.[1]),
    );
});

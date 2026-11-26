// How the gateway finds the connector files (`connectors.ts`): from source, the paths in package.json under `jig.connectors`, which stay inside the package;
// built, `connectors/<name>.mjs` beside the built gateway, for the same names.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { connectorFiles, isInside } from "../../src/gateway/connectors.ts";

const folders: string[] = [];
afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A package folder with a package.json that lists these connectors. */
function packageWith(connectors: unknown): string {
    const folder = mkdtempSync(path.join(tmpdir(), "jig-connectors-"));
    folders.push(folder);
    writeFileSync(path.join(folder, "package.json"), JSON.stringify({ jig: { connectors } }));
    return path.join(folder, "package.json");
}

describe("whether a path is inside a folder", () => {
    test("is true for the folder, what is below it, and a name that only begins with two dots", () => {
        assert.equal(isInside("/pkg", "/pkg"), true);
        assert.equal(isInside("/pkg", "/pkg/plugins/a/connector.ts"), true);
        assert.equal(isInside("/pkg", "/pkg/..assets/connector.ts"), true, "a folder named ..assets is inside");
        assert.equal(isInside("/pkg", "/pkg/..hidden"), true);
    });

    test("is false for the folder above, a sibling and a way out through ..", () => {
        assert.equal(isInside("/pkg", "/"), false);
        assert.equal(isInside("/pkg", "/other/connector.ts"), false);
        assert.equal(isInside("/pkg", "/pkg/../other/connector.ts"), false);
        assert.equal(isInside("/pkg/sub", "/pkg/connector.ts"), false);
    });

    test("is false on Windows for another drive, which has no relative way from this one", () => {
        assert.equal(isInside("C:\\pkg", "C:\\pkg\\plugins\\connector.ts", path.win32), true);
        assert.equal(isInside("C:\\pkg", "C:\\pkg\\..assets\\connector.ts", path.win32), true);
        assert.equal(isInside("C:\\pkg", "C:\\other\\connector.ts", path.win32), false);
        assert.equal(isInside("C:\\pkg", "D:\\pkg\\connector.ts", path.win32), false);
    });
});

describe("the connector files of a package", () => {
    test("from source are the paths the list names, made absolute, in the order of the list", () => {
        const file = packageWith({
            "jig-b": "./plugins/jig-b/src/connector.ts",
            "jig-a": "./plugins/jig-a/src/connector.ts",
        });
        const folder = path.dirname(file);
        assert.deepEqual(connectorFiles(file), [
            { name: "jig-b", file: path.join(folder, "plugins/jig-b/src/connector.ts") },
            { name: "jig-a", file: path.join(folder, "plugins/jig-a/src/connector.ts") },
        ]);
    });

    test("from source accept a folder whose name begins with two dots, and refuse a path that leaves the package", () => {
        const file = packageWith({ "jig-a": "./..plugins/a/connector.ts" });
        assert.equal(connectorFiles(file)[0]?.file, path.join(path.dirname(file), "..plugins/a/connector.ts"));
        assert.throws(
            () => connectorFiles(packageWith({ "jig-a": "../outside/connector.ts" })),
            /points outside the package/,
        );
        assert.throws(
            () => connectorFiles(packageWith({ "jig-a": "./a/../../outside/connector.ts" })),
            /points outside the package/,
        );
    });

    test("built are connectors/<name>.mjs in the folder of the built gateway, for the same names, whatever the paths say", () => {
        const file = packageWith({ "jig-git": "./plugins/jig-git/src/connector.ts", "jig-x": "./anywhere.ts" });
        const built = path.join(path.dirname(file), "plugins/jig-core/dist");
        mkdirSync(built, { recursive: true });
        assert.deepEqual(connectorFiles(file, built), [
            { name: "jig-git", file: path.join(built, "connectors/jig-git.mjs") },
            { name: "jig-x", file: path.join(built, "connectors/jig-x.mjs") },
        ]);
    });

    test("built refuse a plugin name that is a path, because the name is the name of a file", () => {
        const built = "/anywhere/dist";
        assert.throws(() => connectorFiles(packageWith({ "../x": "./a.ts" }), built), /is not a plugin name/);
        assert.throws(() => connectorFiles(packageWith({ "a/b": "./a.ts" }), built), /is not a plugin name/);
    });

    test("a package with no list has no connector files", () => {
        const folder = mkdtempSync(path.join(tmpdir(), "jig-connectors-"));
        folders.push(folder);
        writeFileSync(path.join(folder, "package.json"), "{}");
        assert.deepEqual(connectorFiles(path.join(folder, "package.json")), []);
        assert.deepEqual(connectorFiles(path.join(folder, "package.json"), folder), []);
    });
});

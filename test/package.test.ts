// What npm actually publishes: the CLI, every plugin Pi loads, and the review page's built files, without the tests.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

function pack(): Promise<{ name: string; version: string; files: string[] }> {
    return new Promise((resolve, reject) => {
        const child = spawn("npm", ["pack", "--dry-run", "--json"], { cwd: ROOT });
        let out = "";
        child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`npm pack exited ${code}: ${out.slice(-500)}`));
                return;
            }
            const parsed = JSON.parse(out) as
                | Array<{ name: string; version: string; files: Array<{ path: string }> }>
                | Record<string, { name: string; version: string; files: Array<{ path: string }> }>;
            const one = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]) as
                | { name: string; version: string; files: Array<{ path: string }> }
                | undefined;
            if (one === undefined) {
                reject(new Error("npm pack returned nothing"));
                return;
            }
            resolve({ name: one.name, version: one.version, files: one.files.map((file) => file.path) });
        });
    });
}

test("the npm tarball has the command and the plugins, and no tests", { timeout: 60_000 }, async () => {
    const result = await pack();
    assert.equal(result.name, "@clawdbuilder/jig");
    assert.match(result.version, /^\d+\.\d+\.\d+$/);
    const has = (pattern: RegExp): boolean => result.files.some((file) => pattern.test(file));
    assert.ok(has(/^bin\/jig\.mjs$/), "the command");
    assert.ok(has(/^plugins\/jig-core\/index\.ts$/), "the core plugin");
    assert.ok(has(/^plugins\/jig-core\/src\//), "the core sources");
    assert.ok(has(/^plugins\/jig-review\/web\/dist\/index\.html$/), "the review page");
    assert.ok(!result.files.some((file) => /\/test\/|^test\//.test(file)), "no tests");
    assert.ok(!result.files.some((file) => file.startsWith("local/")), "nothing local");
});

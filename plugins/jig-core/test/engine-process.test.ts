// The engine's own tests run in a second process that cannot load a Pi package (`npm run test:engine`, started with test/support/no-pi.mjs), so
// that a read of Pi by the engine fails there. This file starts that process, so that `npm test` covers it, and fails when it fails. It
// also shows that the guard works: a process started the same way refuses a Pi package.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const NO_PI = path.join(ROOT, "test/support/no-pi.mjs");

/** The environment of a child that starts its own tests: this test run's own marks removed, so that it runs and reports for itself. */
function childEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    // Pi must not be findable either, in case the guard were gone.
    delete env.PI_HOST_DIR;
    return env;
}

function node(args: string[]) {
    return spawnSync(process.execPath, args, { cwd: ROOT, env: childEnv(), encoding: "utf8", timeout: 5 * 60_000 });
}

describe("the engine's tests, in a process with no Pi", () => {
    test("package.json has the script that starts them, with the guard and the folder", () => {
        const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts as Record<
            string,
            string
        >;
        const script = scripts["test:engine"] ?? "";
        assert.match(script, /--import \.\/test\/support\/no-pi\.mjs /);
        assert.match(script, /"plugins\/jig-core\/test\/engine\/\*\.test\.ts"/);
    });

    test("a process started with the guard refuses a Pi package, and loads what is not one", () => {
        for (const specifier of [
            "@earendil-works/pi-coding-agent",
            "@earendil-works/pi-tui",
            "@earendil-works/pi-ai",
        ]) {
            const refused = node(["--import", NO_PI, "--input-type=module", "-e", `await import("${specifier}")`]);
            assert.notEqual(refused.status, 0, `${specifier} loaded`);
            assert.match(refused.stderr, /was imported in a process that has no Pi/);
        }
        const fine = node([
            "--import",
            NO_PI,
            "--input-type=module",
            "-e",
            'await import("node:fs"); await import("typebox"); console.log("loaded")',
        ]);
        assert.equal(fine.status, 0, fine.stderr);
        assert.match(fine.stdout, /loaded/);
    });

    test("the engine's tests pass there", () => {
        const run = node([
            "--import",
            NO_PI,
            "--test",
            "--test-timeout=600000",
            "plugins/jig-core/test/engine/*.test.ts",
        ]);
        // The output is what a person reads when it fails.
        assert.equal(run.status, 0, `${run.stdout.slice(-6000)}\n${run.stderr.slice(-2000)}`);
        assert.match(run.stdout, /ℹ pass [1-9]/);
        assert.match(run.stdout, /ℹ fail 0/);
    });
});

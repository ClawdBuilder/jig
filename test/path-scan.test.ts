// The launcher finds Pi through PATH when JIG_PI_HOST and PI_HOST_DIR are unset: the PATH entry is a symlink, so the
// realpath step is load-bearing and must not be silently skipped.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const BIN = path.join(ROOT, "bin/jig.mjs");

test("a pi on PATH is resolved through its symlink", () => {
    const root = mkdtempSync(path.join(tmpdir(), "jig-path-scan-"));
    try {
        const piPackage = path.join(root, "lib/node_modules/@earendil-works/pi-coding-agent");
        const bin = path.join(root, "bin");
        mkdirSync(piPackage, { recursive: true });
        mkdirSync(bin, { recursive: true });
        writeFileSync(
            path.join(piPackage, "package.json"),
            JSON.stringify({ name: "@earendil-works/pi-coding-agent" }),
        );
        writeFileSync(path.join(piPackage, "pi"), "#!/bin/sh\n");
        symlinkSync(path.join(piPackage, "pi"), path.join(bin, "pi"));
        // Hide the real global Pi next to Node, so the PATH step is the one that has to find this fake package.
        const wrapper = path.join(root, "run.mjs");
        writeFileSync(
            wrapper,
            `Object.defineProperty(process, "execPath", { value: ${JSON.stringify(path.join(root, "no-node"))} });\n` +
                `await import(${JSON.stringify(new URL(`file://${BIN}`).href)});\n`,
        );
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            PATH: `${bin}:/usr/bin:/bin`,
            HOME: path.join(root, "home"),
            PI_CODING_AGENT_DIR: path.join(root, "agent"),
            JIG_STATE_DIR: path.join(root, "state"),
        };
        delete env.JIG_PI_HOST;
        delete env.PI_HOST_DIR;
        let stderr = "";
        try {
            execFileSync(process.execPath, [wrapper, "doctor", "--json"], { encoding: "utf8", env, timeout: 30_000 });
        } catch (error) {
            stderr = String((error as { stderr?: string }).stderr ?? "");
        }
        assert.doesNotMatch(stderr, /jig needs Pi installed/, stderr);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

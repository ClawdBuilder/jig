// `jig setup --source <tarball>` with stock Pi, not the fake: Pi 1.5.2 records a bare path and unpacks nothing, so the
// bootstrap gives it `npm:<absolute path>` and this proves the package lands where setup looks.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { piHostDir } from "../../../test/support/pi-host-dir.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BIN = path.join(ROOT, "bin/jig.mjs");
const PI_CLI = path.join(piHostDir, "dist/bundle/cli.js");

function pack(t: { after: (fn: () => void) => void }): { dir: string; tar: string } | undefined {
    if (!existsSync(PI_CLI)) return undefined;
    if (spawnSync("npm", ["--version"], { encoding: "utf8" }).status !== 0) return undefined;
    const dir = mkdtempSync(path.join(tmpdir(), "jig-source-real-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const pkg = path.join(dir, "pkg");
    mkdirSync(path.join(pkg, "bin"), { recursive: true });
    writeFileSync(
        path.join(pkg, "package.json"),
        JSON.stringify({ name: "@clawdbuilder/jig", version: "0.0.0", bin: { jig: "bin/jig.mjs" } }),
    );
    writeFileSync(path.join(pkg, "bin", "jig.mjs"), "#!/usr/bin/env node\nconsole.log('packed jig');\n");
    const packed = spawnSync("npm", ["pack", "--pack-destination", dir], {
        cwd: pkg,
        encoding: "utf8",
        env: { ...process.env, npm_config_update_notifier: "false" },
    });
    if (packed.status !== 0) throw new Error(`npm pack failed: ${packed.stderr}`);
    return { dir, tar: path.join(dir, packed.stdout.trim().split("\n").at(-1) ?? "") };
}

test("jig setup --source <tarball> installs through npm and finds the home's command", { timeout: 120_000 }, (t) => {
    const fixture = pack(t);
    if (fixture === undefined) {
        t.skip("stock Pi or npm is not available");
        return;
    }
    const root = mkdtempSync(path.join(tmpdir(), "jig-source-home-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const home = path.join(root, "home");
    const agent = path.join(home, ".jig");
    const bin = path.join(root, "bin");
    mkdirSync(agent, { recursive: true });
    mkdirSync(bin);
    symlinkSync(PI_CLI, path.join(bin, "pi"));
    const result = spawnSync(process.execPath, [BIN, "setup", "--source", fixture.tar, "--yes"], {
        cwd: root,
        encoding: "utf8",
        env: {
            ...process.env,
            HOME: home,
            JIG_HOME: agent,
            PI_CODING_AGENT_DIR: agent,
            PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH ?? ""}`,
            BROWSER: "true",
        },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.ok(
        existsSync(path.join(agent, "npm/node_modules/@clawdbuilder/jig/bin/jig.mjs")),
        "the packed Jig is in the home's npm folder",
    );
    assert.match(
        result.stdout,
        new RegExp(`Installing Jig \\(npm:${fixture.tar.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\)`),
    );
});

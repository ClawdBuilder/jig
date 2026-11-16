// A captured `jig doctor` sample names the package version. The check fails when that line is stale, so a release
// cannot leave a person reading last version's output.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/check-version-pins.mjs");

function root(version: string, captured: string, docs: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-version-pins-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
    writeFileSync(path.join(dir, "README.md"), captured);
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "docs", "first-hour.md"), docs);
    return dir;
}

function run(t: { after: (fn: () => void) => void }, dir: string) {
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return spawnSync(process.execPath, [SCRIPT], {
        encoding: "utf8",
        env: { ...process.env, JIG_VERSION_PINS_ROOT: dir },
    });
}

test("a captured Jig — line older than package.json fails and says to re-capture", (t) => {
    const dir = root("1.2.3", "Jig doctor · 1 ok\n  ok Jig — 1.2.2\n", "  ok Jig — 1.2.3\n");
    const result = run(t, dir);
    assert.equal(result.status, 1);
    assert.match(
        result.stdout,
        /README\.md:2 captured Jig — 1\.2\.2 but package\.json is 1\.2\.3; re-capture the doctor block/,
    );
});

test("captured lines at the package version pass", (t) => {
    const dir = root("1.2.3", "  ok Jig — 1.2.3\n", "  ok Jig — 1.2.3\n");
    const result = run(t, dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /version pins: 0 failures/);
});

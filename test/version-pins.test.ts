// A captured `jig doctor` sample names the package version. The check fails when that line is stale, so a release
// cannot leave a person reading last version's output.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/check-version-pins.mjs");

/** The versions the two files of the Claude Code plugin name, when they differ from the package's. */
interface PluginVersions {
    plugin?: string;
    marketplace?: string;
}

function root(version: string, captured: string, docs: string, plugin: PluginVersions = {}): string {
    const dir = mkdtempSync(path.join(tmpdir(), "jig-version-pins-"));
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version }));
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({ version, packages: { "": { version } } }));
    mkdirSync(path.join(dir, ".claude-plugin"));
    writeFileSync(
        path.join(dir, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "jig", version: plugin.plugin ?? version }),
    );
    writeFileSync(
        path.join(dir, ".claude-plugin", "marketplace.json"),
        JSON.stringify({
            name: "market",
            plugins: [{ name: "jig", source: "./", version: plugin.marketplace ?? version }],
        }),
    );
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

test("a plugin.json whose version is not the package's fails, and names the file and both versions", (t) => {
    const dir = root("1.2.3", "  ok Jig — 1.2.3\n", "", { plugin: "1.2.2" });
    const result = run(t, dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /\.claude-plugin\/plugin\.json version 1\.2\.2 differs from package\.json 1\.2\.3/);
    assert.doesNotMatch(result.stdout, /marketplace\.json/);
});

test("a marketplace.json whose plugin has another version fails, and names the file and both versions", (t) => {
    const dir = root("1.2.3", "  ok Jig — 1.2.3\n", "", { marketplace: "1.3.0" });
    const result = run(t, dir);
    assert.equal(result.status, 1);
    assert.match(
        result.stdout,
        /\.claude-plugin\/marketplace\.json version 1\.3\.0 differs from package\.json 1\.2\.3/,
    );
    assert.doesNotMatch(result.stdout, /plugin\.json version/);
});

test("a plugin file that is missing, is not JSON or names no version fails", (t) => {
    const missing = root("1.2.3", "", "");
    rmSync(path.join(missing, ".claude-plugin", "plugin.json"));
    assert.match(run(t, missing).stdout, /fail \.claude-plugin\/plugin\.json is missing or is not JSON/);

    const broken = root("1.2.3", "", "");
    writeFileSync(path.join(broken, ".claude-plugin", "marketplace.json"), "{ not json");
    assert.match(run(t, broken).stdout, /fail \.claude-plugin\/marketplace\.json is missing or is not JSON/);

    const none = root("1.2.3", "", "");
    writeFileSync(
        path.join(none, ".claude-plugin", "marketplace.json"),
        JSON.stringify({ name: "market", plugins: [] }),
    );
    const result = run(t, none);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /fail \.claude-plugin\/marketplace\.json names no version/);
});

// scripts/release.mjs and scripts/release-notes.mjs: a release moves the Unreleased entries under a dated heading and raises
// the version, or says what stops it; the release notes are the section a tag's GitHub release carries. Nothing here commits,
// tags or pushes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const folders: string[] = [];
afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** Runs a script of scripts/ with its arguments. */
function run(script: string, args: string[]): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** A folder with the two files a release changes. */
function project(version: string, changelog: string): string {
    const root = mkdtempSync(path.join(tmpdir(), "jig-release-"));
    folders.push(root);
    writeFileSync(
        path.join(root, "package.json"),
        `${JSON.stringify({ name: "jig", version, private: true }, null, 4)}\n`,
    );
    writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
    return root;
}

/** The Unreleased entries of a changelog, with two headings repeated and the sections out of order. */
const CHANGELOG = [
    "# Changelog",
    "",
    "What changed in Jig, newest first.",
    "",
    "## [Unreleased]",
    "",
    "### Fixed",
    "",
    "- A fix written before the first Added block.",
    "",
    "### Added",
    "",
    "- The first added entry.",
    "",
    "### Fixed",
    "",
    "- Another fix.",
    "",
    "### Changed",
    "",
    "- A change.",
    "",
    "## [0.2.0] - 2026-11-02",
    "",
    "### Added",
    "",
    "- An older entry.",
    "",
].join("\n");

describe("release", () => {
    test("moves the Unreleased entries under the version and the date, gathers their headings, and raises the version", () => {
        const root = project("0.2.0", CHANGELOG);
        const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]);
        assert.equal(status, 0, output);
        const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        assert.match(changelog, /## \[Unreleased\]\n\n## \[0\.3\.0\] - 2026-11-04\n/, output);
        assert.equal(changelog.match(/^### Added$/gm)?.length, 2, "one under 0.3.0, one under 0.2.0");
        assert.equal(changelog.match(/^### Fixed$/gm)?.length, 1, "the two Fixed headings are gathered into one");
        assert.equal(changelog.match(/^### Changed$/gm)?.length, 1);
        // Added, Changed, Fixed: the order the file writes them in, whatever order the Unreleased body had
        assert.ok(
            changelog.indexOf("### Added") < changelog.indexOf("### Changed") &&
                changelog.indexOf("### Changed") < changelog.indexOf("### Fixed"),
            changelog,
        );
        // the entries are kept, in the order they were written under their own heading
        const fixed = changelog.slice(changelog.indexOf("### Fixed"));
        assert.ok(fixed.indexOf("A fix written before") < fixed.indexOf("Another fix"), fixed);
        // two blocks of one heading meet with one blank line between them, not two
        const released = changelog.slice(changelog.indexOf("## [0.3.0]"), changelog.indexOf("## [0.2.0]"));
        assert.doesNotMatch(released, /\n\n\n/, released);
        // the older release is untouched
        assert.match(changelog, /## \[0\.2\.0\] - 2026-11-02\n\n### Added\n\n- An older entry\./);
        assert.match(output, /changed CHANGELOG\.md and package\.json/);
        assert.match(output, /holds 4 entries/);
        const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
        assert.equal(manifest.version, "0.3.0");
        assert.equal(manifest.private, true, "the rest of the manifest is kept");
    });

    test("keeps one blank line where the body had two, and keeps a blank line inside a fenced block", () => {
        const changelog = [
            "# Changelog",
            "",
            "## [Unreleased]",
            "",
            "### Added",
            "",
            "- First.",
            "",
            "",
            "- Second.",
            "",
            "```text",
            "one",
            "",
            "two",
            "```",
            "",
            "## [0.2.0] - 2026-11-02",
            "",
            "- Old.",
            "",
        ].join("\n");
        const root = project("0.2.0", changelog);
        const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]);
        assert.equal(status, 0, output);
        const text = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        assert.match(text, /- First\.\n\n- Second\./, "two blank lines are one");
        assert.match(text, /one\n\ntwo/, "the blank line of a fenced block is kept");
        assert.doesNotMatch(text, /\n\n\n/);
    });

    test("changes nothing with --dry-run, and says what it would change", () => {
        const root = project("0.2.0", CHANGELOG);
        const before = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root, "--dry-run"]);
        assert.equal(status, 0, output);
        assert.match(output, /would change/);
        assert.equal(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), before);
        assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, "0.2.0");
    });

    test("says what stops it and writes nothing: an old version, a version that is not x.y.z, and nothing to release", () => {
        const cases: { args: string[]; changelog: string; says: RegExp }[] = [
            { args: ["0.2.0"], changelog: CHANGELOG, says: /is not newer than package\.json's 0\.2\.0/ },
            { args: ["v0.3.0"], changelog: CHANGELOG, says: /is not a version of the form 1\.2\.3/ },
            { args: ["0.3.0", "--date", "04/11/2026"], changelog: CHANGELOG, says: /is not a date of the form/ },
            {
                args: ["0.3.0"],
                changelog: CHANGELOG.replace(/- A change\.\n/, "")
                    .replace(/- Another fix\.\n/, "")
                    .replace(/- The first added entry\.\n/, "")
                    .replace(/- A fix written before the first Added block\.\n/, ""),
                says: /has no entries: nothing to release/,
            },
            {
                args: ["0.3.0"],
                changelog: CHANGELOG.replace("## [Unreleased]", "## [Next]"),
                says: /no `## \[Unreleased\]` heading/,
            },
        ];
        for (const { args, changelog, says } of cases) {
            const root = project("0.2.0", changelog);
            const { status, output } = run("release.mjs", [...args, "--root", root]);
            assert.equal(status, 1, output);
            assert.match(output, says);
            assert.match(output, /Nothing was written/);
            assert.equal(
                readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
                changelog,
                "the changelog is untouched",
            );
            assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, "0.2.0");
        }
    });
});

test("the release job leaves room for the npm confirmation loop", () => {
    const text = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
    const timeout = Number(/timeout-minutes:\s*(\d+)/.exec(text)?.[1]);
    const attempts = Number(/seq 1 (\d+)/.exec(text)?.[1]);
    assert.ok(Number.isFinite(timeout) && Number.isFinite(attempts));
    assert.ok(
        timeout * 60 >= attempts * 2 + 5 * 60,
        `a ${timeout}-minute job cannot finish a ${attempts}-attempt, two-second loop plus packing and the release`,
    );
});

describe("release-notes", () => {
    test("prints the entries of a release, without its heading, and nothing else", () => {
        const root = project("0.2.0", CHANGELOG);
        assert.equal(run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]).status, 0);
        const { status, output } = run("release-notes.mjs", ["0.3.0", "--root", root]);
        assert.equal(status, 0, output);
        assert.match(output, /^### Added\n\n- The first added entry\./);
        assert.match(output, /- Another fix\./);
        assert.doesNotMatch(output, /## \[0\.3\.0\]/);
        assert.doesNotMatch(output, /An older entry/, "another release's entries are not in the notes");
    });

    test("fails when the changelog has no such section, so a tag without entries writes no release", () => {
        const root = project("0.2.0", CHANGELOG);
        const { status, output } = run("release-notes.mjs", ["0.9.9", "--root", root]);
        assert.equal(status, 1, output);
        assert.match(output, /no section ## \[0\.9\.9\] with entries/);
    });
});

describe("this repository", () => {
    test("has an Unreleased heading to release from, and a version of the form 1.2.3", () => {
        const changelog = readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
        assert.match(changelog, /^## \[Unreleased\]$/m);
        assert.match(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version, /^\d+\.\d+\.\d+$/);
    });
});

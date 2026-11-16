// scripts/release.mjs, scripts/release-notes.mjs and scripts/check-changelog-fragments.mjs: a release folds changelog.d/
// into a dated heading, deletes the fragments and raises the version, or says what stops it; the release notes are the
// section a tag's GitHub release carries. Nothing here commits, tags or pushes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** A folder with the files a release changes, and its changelog.d fragments. */
function project(version: string, changelog: string, fragments: Record<string, string> = {}): string {
    const root = mkdtempSync(path.join(tmpdir(), "jig-release-"));
    folders.push(root);
    writeFileSync(
        path.join(root, "package.json"),
        `${JSON.stringify({ name: "jig", version, private: true }, null, 4)}\n`,
    );
    writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
    mkdirSync(path.join(root, "changelog.d"));
    for (const [name, text] of Object.entries(fragments)) {
        writeFileSync(path.join(root, "changelog.d", name), text);
    }
    return root;
}

/** The pointer the release keeps, and one older release that must not change. */
const CHANGELOG = [
    "# Changelog",
    "",
    "What changed in Jig, newest first.",
    "",
    "## [Unreleased]",
    "",
    "A change a user would notice is one file in `changelog.d/`.",
    "",
    "## [0.2.0] - 2026-11-02",
    "",
    "### Added",
    "",
    "- An older entry.",
    "",
].join("\n");

/** Four fragments: two headings, two files under Fixed. */
const FRAGMENTS = {
    "01-fixed.md": ["### Fixed", "", "- A fix written before the first Added block.", ""].join("\n"),
    "02-added.md": ["### Added", "", "- The first added entry.", ""].join("\n"),
    "03-fixed.md": ["### Fixed", "", "- Another fix.", ""].join("\n"),
    "04-changed.md": "### Changed\n- A change.\n",
    "05-removed.md": ["### Removed", "", "- A removal.", ""].join("\n"),
};

describe("release", () => {
    test("folds every fragment under the version and date, gathers their headings, and keeps the Unreleased sentence", () => {
        const root = project("0.2.0", CHANGELOG, FRAGMENTS);
        const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]);
        assert.equal(status, 0, output);
        const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        const unreleased = changelog.slice(changelog.indexOf("## [Unreleased]"), changelog.indexOf("## [0.3.0]"));
        assert.match(unreleased, /A change a user would notice is one file in `changelog\.d\/`\./, unreleased);
        assert.match(changelog, /## \[0\.3\.0\] - 2026-11-04\n/, output);
        assert.equal(changelog.match(/^### Added$/gm)?.length, 2, "one under 0.3.0, one under 0.2.0");
        assert.equal(changelog.match(/^### Fixed$/gm)?.length, 1, "the two Fixed fragments are gathered into one");
        assert.equal(changelog.match(/^### Changed$/gm)?.length, 1);
        assert.equal(changelog.match(/^### Removed$/gm)?.length, 1);
        // Added, Changed, Fixed: the order the file writes them in, whatever order the fragments are in
        assert.ok(
            changelog.indexOf("### Added") < changelog.indexOf("### Changed") &&
                changelog.indexOf("### Changed") < changelog.indexOf("### Fixed") &&
                changelog.indexOf("### Fixed") < changelog.indexOf("### Removed"),
            changelog,
        );
        // two files under one heading keep their file order
        const fixed = changelog.slice(changelog.indexOf("### Fixed"));
        assert.ok(fixed.indexOf("A fix written before") < fixed.indexOf("Another fix"), fixed);
        const released = changelog.slice(changelog.indexOf("## [0.3.0]"), changelog.indexOf("## [0.2.0]"));
        assert.doesNotMatch(released, /\n\n\n/, released);
        // the older release is byte for byte what it was
        assert.ok(changelog.endsWith(CHANGELOG.slice(CHANGELOG.indexOf("## [0.2.0]"))), "the older release changed");
        // the fragments are gone, and the version is raised
        assert.deepEqual(readdirSync(path.join(root, "changelog.d")), []);
        assert.match(output, /holds 5 entries/);
        assert.match(output, /folded and deleted 5 fragments/);
        const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
        assert.equal(manifest.version, "0.3.0");
        assert.equal(manifest.private, true, "the rest of the manifest is kept");
    });

    test("one blank line where a fragment had two, and a blank line inside a fenced block is kept", () => {
        const fragments = {
            "a.md": ["### Added", "", "- First.", "", "", "- Second.", ""].join("\n"),
            "b.md": ["### Added", "", "- Third.", ""].join("\n"),
            "c.md": ["### Added", "", "- A block follows.", "", "```text", "one", "", "two", "```", ""].join("\n"),
        };
        const root = project("0.2.0", CHANGELOG, fragments);
        const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]);
        assert.equal(status, 0, output);
        const text = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        assert.match(text, /- First\.\n\n- Second\.\n\n- Third\.\n\n- A block follows\./, text);
        assert.match(text, /one\n\ntwo/, "the blank line of a fenced block is kept");
        assert.doesNotMatch(text.slice(text.indexOf("## [0.3.0]"), text.indexOf("## [0.2.0]")), /\n\n\n/);
    });

    test("changes nothing with --dry-run, and says what it would change", () => {
        const root = project("0.2.0", CHANGELOG, FRAGMENTS);
        const before = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
        const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root, "--dry-run"]);
        assert.equal(status, 0, output);
        assert.match(output, /would change/);
        assert.match(output, /would fold and delete 5 fragments/);
        assert.equal(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), before);
        assert.equal(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version, "0.2.0");
        assert.deepEqual(readdirSync(path.join(root, "changelog.d")).sort(), Object.keys(FRAGMENTS).sort());
    });

    test("says what stops it and writes nothing: an old version, a bad date, no fragments, or an entry under [Unreleased]", () => {
        const cases: { args: string[]; changelog: string; fragments: Record<string, string>; says: RegExp }[] = [
            {
                args: ["0.2.0"],
                changelog: CHANGELOG,
                fragments: FRAGMENTS,
                says: /is not newer than package\.json's 0\.2\.0/,
            },
            {
                args: ["v0.3.0"],
                changelog: CHANGELOG,
                fragments: FRAGMENTS,
                says: /is not a version of the form 1\.2\.3/,
            },
            {
                args: ["0.3.0", "--date", "04/11/2026"],
                changelog: CHANGELOG,
                fragments: FRAGMENTS,
                says: /is not a date of the form/,
            },
            {
                args: ["0.3.0"],
                changelog: CHANGELOG,
                fragments: {},
                says: /changelog\.d\/ has no fragments: nothing to release/,
            },
            {
                args: ["0.3.0"],
                changelog: CHANGELOG.replace(
                    "A change a user would notice is one file in `changelog.d/`.",
                    "A change a user would notice is one file in `changelog.d/`.\n\n- An entry written under Unreleased.",
                ),
                fragments: FRAGMENTS,
                says: /`## \[Unreleased\]` has entries: put each change in changelog\.d\//,
            },
            {
                args: ["0.3.0"],
                changelog: CHANGELOG.replace("## [Unreleased]", "## [Next]"),
                fragments: FRAGMENTS,
                says: /no `## \[Unreleased\]` heading/,
            },
        ];
        for (const { args, changelog, fragments, says } of cases) {
            const root = project("0.2.0", changelog, fragments);
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
            assert.deepEqual(readdirSync(path.join(root, "changelog.d")).sort(), Object.keys(fragments).sort());
        }
    });

    test("a fragment a release cannot fold is refused, naming the file and the reason", () => {
        const cases: { name: string; text: string; says: RegExp }[] = [
            {
                name: "improved.md",
                text: "### Improved\n\n- A line.\n",
                says: /changelog\.d\/improved\.md: "Improved" is not a heading; use Added, Changed, Fixed, Removed/,
            },
            {
                name: "no-line.md",
                text: "### Added\n\nA sentence that is not a list line.\n",
                says: /changelog\.d\/no-line\.md: has no `- ` line under its heading/,
            },
            {
                name: "two-headings.md",
                text: "### Added\n\n- One.\n\n### Fixed\n\n- Two.\n",
                says: /changelog\.d\/two-headings\.md: holds more than one heading/,
            },
        ];
        for (const { name, text, says } of cases) {
            const root = project("0.2.0", CHANGELOG, { [name]: text });
            const { status, output } = run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]);
            assert.equal(status, 1, output);
            assert.match(output, says);
            assert.doesNotMatch(output, /has no fragments/, "the bad fragment is the problem, not an empty folder");
            assert.match(output, /Nothing was written/);
            assert.equal(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), CHANGELOG);
            assert.equal(readFileSync(path.join(root, "changelog.d", name), "utf8"), text);
        }
    });
});

describe("changelog fragments", () => {
    test("the check accepts what a release can fold and names each bad file", () => {
        const good = project("0.2.0", CHANGELOG, FRAGMENTS);
        const accepted = run("check-changelog-fragments.mjs", [good]);
        assert.equal(accepted.status, 0, accepted.output);
        assert.match(accepted.output, /0 failures \(5 checked\)/);

        const bad = project("0.2.0", CHANGELOG, { "unknown.md": "### Improved\n\n- A line.\n" });
        const refused = run("check-changelog-fragments.mjs", [bad]);
        assert.equal(refused.status, 1, refused.output);
        assert.match(refused.output, /fail changelog\.d\/unknown\.md: "Improved" is not a heading/);
        assert.match(refused.output, /1 failure \(1 checked\)/);
    });

    test("npm run check runs the fragment check", () => {
        const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
        assert.match(scripts.check, /check-changelog-fragments\.mjs/);
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
        const root = project("0.2.0", CHANGELOG, FRAGMENTS);
        assert.equal(run("release.mjs", ["0.3.0", "--date", "2026-11-04", "--root", root]).status, 0);
        const { status, output } = run("release-notes.mjs", ["0.3.0", "--root", root]);
        assert.equal(status, 0, output);
        assert.match(output, /^### Added\n\n- The first added entry\./);
        assert.match(output, /- Another fix\./);
        assert.match(output, /- A change\./);
        assert.doesNotMatch(output, /## \[0\.3\.0\]/);
        assert.doesNotMatch(output, /An older entry/, "another release's entries are not in the notes");
    });

    test("fails when the changelog has no such section, so a tag without entries writes no release", () => {
        const root = project("0.2.0", CHANGELOG, FRAGMENTS);
        const { status, output } = run("release-notes.mjs", ["0.9.9", "--root", root]);
        assert.equal(status, 1, output);
        assert.match(output, /no section ## \[0\.9\.9\] with entries/);
    });
});

test("publishing uses Trusted Publishing behind the Release environment, with no stored npm token", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/release.yml"), "utf8");
    const start = workflow.indexOf("  publish:");
    const end = workflow.indexOf("  release:", start);
    assert.ok(start !== -1 && end !== -1, "the workflow has publish and release jobs");
    const publish = workflow.slice(start, end);
    assert.match(publish, /environment: Release/);
    assert.doesNotMatch(workflow, /NPM_TOKEN/);
    assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN/);
    assert.match(publish, /id-token: write/);
    assert.match(publish, /npm ci --ignore-scripts/);
    assert.match(publish, /11\.5\.1/);
    assert.match(publish, /npm publish --provenance --access public/);
    assert.doesNotMatch(publish, /contents: write/, "publishing cannot write the repository");
    assert.match(workflow, /needs: publish/);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch' \|\| needs\.publish\.result == 'success'/);
});

describe("this repository", () => {
    test("has an Unreleased heading, the folder it points at, and a version of the form 1.2.3", () => {
        const changelog = readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
        assert.match(changelog, /^## \[Unreleased\]$/m);
        assert.match(changelog, /changelog\.d\//);
        assert.ok(existsSync(path.join(ROOT, "changelog.d")), "changelog.d/ is missing");
        assert.match(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version, /^\d+\.\d+\.\d+$/);
    });
});

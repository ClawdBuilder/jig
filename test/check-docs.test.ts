// Each docs failure the checker promises, on a small tree: the checker itself is the thing under test.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
// @ts-expect-error the checker is plain JavaScript
import { baselineFailures, checkDocs, warningCounts } from "../scripts/check-docs.mjs";

function tree(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmpdir(), "jig-docs-"));
    for (const [name, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        writeFileSync(path.join(root, name), text);
    }
    return root;
}

test("a plugin README needs its title and status line in order", () => {
    const root = tree({ "plugins/x/README.md": "<img>\n\n# jig-x: one\n" });
    assert.ok(checkDocs(root).failures.some((one: string) => one.includes("title must be")));
    assert.ok(checkDocs(root).failures.some((one: string) => one.includes("status line")));
});

test("an unresolved link, an untagged block and a deprecated install all fail", () => {
    const root = tree({
        "README.md": "[x](missing.md)\n\n```\ncode\n```\n\nnpm install -g @clawdbuilder/jig@0.4.1\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(failures.some((one: string) => one.includes("link does not resolve")));
    assert.ok(failures.some((one: string) => one.includes("no language tag")));
    assert.ok(failures.some((one: string) => one.includes("names 0.4.1")));
});

test("a deprecated install inside a fenced block fails", () => {
    const root = tree({
        "README.md": "```bash\nnpm install -g @clawdbuilder/jig@0.4.1\n```\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(
        failures.some((one: string) => one.includes("names 0.4.1")),
        failures.join("\n"),
    );
});

test("deprecated install advice in prose or a code span fails", () => {
    const root = tree({
        "docs/setup.md": "Add `@0.4.0` to install a release rather than the latest.\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(
        failures.some((one: string) => one.includes("names 0.4.0")),
        failures.join("\n"),
    );
});

test("same-page anchors are checked against this document's headings", () => {
    const root = tree({
        "README.md": "# Title\n\n[good](#title) and [bad](#missing)\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(
        failures.some((one: string) => one.includes("anchor does not resolve: #missing")),
        failures.join("\n"),
    );
    assert.ok(!failures.some((one: string) => one.includes("#title")), failures.join("\n"));
});

test("a heading-looking line inside a fence is not an anchor", () => {
    const root = tree({
        "README.md": "# Real\n\n```text\n# Fake\n```\n\n[bad](#fake)\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(
        failures.some((one: string) => one.includes("anchor does not resolve: #fake")),
        failures.join("\n"),
    );
});

test("a fenced block left open is a failure, not a silent skip of the rest", () => {
    const root = tree({
        "README.md": "# Title\n\n```bash\nnpm install -g @clawdbuilder/jig@0.4.2\n\n[bad](missing.md)\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(
        failures.some((one: string) => one.includes("unclosed code block")),
        failures.join("\n"),
    );
});

test("an indented line after a paragraph is an orphan, as the README had", () => {
    // The shape left by a deleted bullet: an intro line, a blank, then the old bullet's second line, indented.
    const root = tree({
        "README.md":
            "# Title\n\n## What is next\n\nWork with a page behind it, not a promise:\n\n  from `jig-jira`, and embeddings after real-ticket recall.\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(
        failures.some((one: string) => one.includes("indented line after a paragraph")),
        failures.join("\n"),
    );
});

test("a list item's indented second paragraph is not an orphan", () => {
    const root = tree({
        "docs/page.md": "# Title\n\n- an item\n  - a sub-item\n\n  a second paragraph of the item\n\n- the next item\n",
    });
    assert.deepEqual(checkDocs(root).failures, []);
});

test("a wrapped list item line is not an orphan", () => {
    const root = tree({ "docs/page.md": "# Title\n\n- an item whose line wraps\n  and continues here\n" });
    assert.deepEqual(checkDocs(root).failures, []);
});

test("the root README's first section is Install, with a bash block by line 20", () => {
    const fence = "```";
    const good = tree({
        "README.md": [
            "# T",
            "",
            "Intro.",
            "",
            "## Install",
            "",
            `${fence}bash`,
            "npx x setup",
            fence,
            "",
            `${fence}text`,
            "ok",
            fence,
            "",
        ].join("\n"),
    });
    assert.deepEqual(
        checkDocs(good).failures.filter((one: string) => one.includes("README.md")),
        [],
    );
    const late = tree({
        "README.md": [
            "# T",
            "",
            "Intro.",
            "",
            ...Array.from({ length: 20 }, () => "filler"),
            "",
            "## Install",
            "",
            `${fence}bash`,
            "run",
            fence,
            "",
        ].join("\n"),
    });
    assert.ok(
        checkDocs(late).failures.some((one: string) => one.includes("after line 20")),
        checkDocs(late).failures.join("\n"),
    );
    const wrongFirst = tree({
        "README.md": [
            "# T",
            "",
            "## What",
            "",
            `${fence}bash`,
            "run",
            fence,
            "",
            "## Install",
            "",
            `${fence}text`,
            "out",
            fence,
            "",
        ].join("\n"),
    });
    assert.ok(checkDocs(wrongFirst).failures.some((one: string) => one.includes("first section must be Install")));
});

test("the root README's Install section shows a text output block", () => {
    const fence = "```";
    const missing = tree({ "README.md": ["# T", "", "## Install", "", `${fence}bash`, "run", fence, ""].join("\n") });
    assert.ok(
        checkDocs(missing).failures.some((one: string) => one.includes("no text output block")),
        checkDocs(missing).failures.join("\n"),
    );
    const after = tree({
        "README.md": [
            "# T",
            "",
            "## Install",
            "",
            `${fence}bash`,
            "run",
            fence,
            "",
            `${fence}text`,
            "out",
            fence,
            "",
        ].join("\n"),
    });
    assert.deepEqual(checkDocs(after).failures, []);
});

test("the warning baseline counts each kind and fails only when a count goes up", () => {
    const warnings = [
        "docs/a.md:1 paragraph is long",
        "docs/b.md:2 table cell is long",
        "docs/b.md:3 table cell is long",
        "plugins/x/README.md: 130 lines (about 120)",
        "some other warning",
    ];
    assert.deepEqual(warningCounts(warnings), { paragraph: 1, cell: 2, readme: 1, other: 1 });
    assert.deepEqual(baselineFailures(warnings, { paragraph: 1, cell: 2, readme: 1, other: 1 }), []);
    assert.match(
        baselineFailures(warnings, { paragraph: 0, cell: 2, readme: 1, other: 1 }).join("\n"),
        /2 cell warnings, baseline 2|1 paragraph warning, baseline 0/,
    );
});

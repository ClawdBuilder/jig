// Each docs failure the checker promises, on a small tree: the checker itself is the thing under test.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
// @ts-expect-error the checker is plain JavaScript
import { checkDocs } from "../scripts/check-docs.mjs";

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
    assert.ok(failures.some((one: string) => one.includes("names 0.4.1")), failures.join("\n"));
});

test("deprecated install advice in prose or a code span fails", () => {
    const root = tree({
        "docs/setup.md": "Add `@0.4.0` to install a release rather than the latest.\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(failures.some((one: string) => one.includes("names 0.4.0")), failures.join("\n"));
});

test("same-page anchors are checked against this document's headings", () => {
    const root = tree({
        "README.md": "# Title\n\n[good](#title) and [bad](#missing)\n",
    });
    const failures = checkDocs(root).failures;
    assert.ok(failures.some((one: string) => one.includes("anchor does not resolve: #missing")), failures.join("\n"));
    assert.ok(!failures.some((one: string) => one.includes("#title")), failures.join("\n"));
});

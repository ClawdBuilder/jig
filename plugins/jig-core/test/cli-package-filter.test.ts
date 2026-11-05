// Pi's package filter, read the way Pi 1.5 reads it: table cases taken from its own rules, so a filter Jig evaluates is the
// filter Pi applies.
import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { enabledFiles, filterOf } from "../src/cli/package-filter.ts";

const root = "/pkg";
const files = [
    "/pkg/plugins/jig-core/index.ts",
    "/pkg/plugins/jig-jira/index.ts",
    "/pkg/plugins/jig-jira/skills/jira/SKILL.md",
    "/pkg/plugins/jig-agents/index.ts",
];
const rel = (patterns: string[]): string[] =>
    [...enabledFiles(files, filterOf({ source: "/pkg", extensions: patterns }), "extensions", root)]
        .map((file) => path.relative(root, file))
        .sort();

describe("Pi's package filter", () => {
    test("a plain string entry, or an object with no list, loads everything", () => {
        assert.equal(filterOf("/pkg"), undefined);
        assert.equal(filterOf({ source: "/pkg", autoload: true }), undefined);
        assert.equal(enabledFiles(files, filterOf({ source: "/pkg" }), "extensions", root).size, files.length);
    });

    test("a list is includes, and `!` takes away", () => {
        assert.deepEqual(rel(["plugins/jig-jira/index.ts"]), ["plugins/jig-jira/index.ts"]);
        assert.deepEqual(rel(["!plugins/jig-jira/index.ts"]), [
            "plugins/jig-agents/index.ts",
            "plugins/jig-core/index.ts",
            "plugins/jig-jira/skills/jira/SKILL.md",
        ]);
    });

    test("an empty list disables the type", () => {
        assert.deepEqual(rel([]), []);
    });

    test("a leading ./ does not match, as in Pi", () => {
        assert.deepEqual(rel(["!./plugins/jig-jira/index.ts"]), [
            "plugins/jig-agents/index.ts",
            "plugins/jig-core/index.ts",
            "plugins/jig-jira/index.ts",
            "plugins/jig-jira/skills/jira/SKILL.md",
        ]);
    });

    test("a glob matches relative paths, names and absolute paths", () => {
        assert.deepEqual(rel(["plugins/jig-*/index.ts"]), [
            "plugins/jig-agents/index.ts",
            "plugins/jig-core/index.ts",
            "plugins/jig-jira/index.ts",
        ]);
        assert.deepEqual(rel(["index.ts"]), [
            "plugins/jig-agents/index.ts",
            "plugins/jig-core/index.ts",
            "plugins/jig-jira/index.ts",
        ]);
        assert.deepEqual(rel(["/pkg/plugins/jig-core/index.ts"]), ["plugins/jig-core/index.ts"]);
    });

    test("`+` forces an exact file back in after an exclude", () => {
        assert.deepEqual(rel(["!plugins/jig-*/index.ts", "+plugins/jig-jira/index.ts"]), [
            "plugins/jig-jira/index.ts",
            "plugins/jig-jira/skills/jira/SKILL.md",
        ]);
    });

    test("`-` forces an exact file out after an include", () => {
        assert.deepEqual(rel(["plugins/jig-jira/index.ts", "-plugins/jig-jira/index.ts"]), []);
    });

    test("autoload:false starts from nothing and turns named files on", () => {
        const filter = filterOf({ source: "/pkg", autoload: false, extensions: ["plugins/jig-core/index.ts"] });
        assert.deepEqual(
            [...enabledFiles(files, filter, "extensions", root)].map((file) => path.relative(root, file)),
            ["plugins/jig-core/index.ts"],
        );
        assert.equal(enabledFiles(files, filterOf({ source: "/pkg", autoload: false }), "extensions", root).size, 0);
    });
});

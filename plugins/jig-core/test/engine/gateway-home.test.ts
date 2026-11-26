// Where the settings folder is without Pi: an argument, then the variable `JIG_HOME`, then the default Jig home, but only when it holds a jig.json.
// An empty value counts as not set, because Claude Code passes an empty string for a value nobody set.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { settingsHome } from "../../src/settings-home.ts";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A person's home folder, with a default Jig home in it when `withJson` is a boolean: with a jig.json (true) or an empty folder (false). */
function homeFolder(withJson?: boolean): string {
    const root = mkdtempSync(path.join(tmpdir(), "jig-home-"));
    roots.push(root);
    if (withJson !== undefined) {
        mkdirSync(path.join(root, ".jig"));
        if (withJson) writeFileSync(path.join(root, ".jig", "jig.json"), "{}");
    }
    return root;
}

describe("settingsHome", () => {
    test("an argument comes first, in both forms, and wins over the variable and the default home", () => {
        const home = homeFolder(true);
        const env = { JIG_HOME: "/from/env" };
        assert.deepEqual(settingsHome(["--home", "/from/argument"], env, home), {
            folder: "/from/argument",
            source: "argument",
        });
        assert.deepEqual(settingsHome(["--home=/from/argument"], env, home), {
            folder: "/from/argument",
            source: "argument",
        });
        assert.deepEqual(settingsHome(["--other", "--home", "/first", "--home", "/second"], {}, home), {
            folder: "/first",
            source: "argument",
        });
    });

    test("the variable comes next, and a relative folder is made absolute", () => {
        const home = homeFolder(true);
        assert.deepEqual(settingsHome([], { JIG_HOME: "/from/env" }, home), {
            folder: "/from/env",
            source: "environment",
        });
        assert.deepEqual(settingsHome([], { JIG_HOME: "settings" }, home), {
            folder: path.resolve("settings"),
            source: "environment",
        });
    });

    test("an empty value is not set: an empty variable, a blank one and an empty argument fall through", () => {
        const home = homeFolder(true);
        const standing = { folder: path.join(home, ".jig"), source: "default" };
        assert.deepEqual(settingsHome([], { JIG_HOME: "" }, home), standing);
        assert.deepEqual(settingsHome([], { JIG_HOME: "   " }, home), standing);
        assert.deepEqual(settingsHome(["--home", ""], {}, home), standing);
        assert.deepEqual(settingsHome(["--home="], {}, home), standing);
        assert.deepEqual(settingsHome(["--home"], {}, home), standing, "an argument with no value");
        assert.deepEqual(settingsHome(["--home", ""], { JIG_HOME: "/from/env" }, home), {
            folder: "/from/env",
            source: "environment",
        });
    });

    test("the default home counts only when it holds a jig.json", () => {
        const withJson = homeFolder(true);
        assert.deepEqual(settingsHome([], {}, withJson), { folder: path.join(withJson, ".jig"), source: "default" });
        assert.equal(settingsHome([], {}, homeFolder(false)), undefined, "a default home with no jig.json");
        assert.equal(settingsHome([], {}, homeFolder()), undefined, "no default home");
    });

    test("a named folder is used even when it holds no jig.json yet", () => {
        const home = homeFolder();
        const named = path.join(home, "elsewhere");
        assert.deepEqual(settingsHome([], { JIG_HOME: named }, home), { folder: named, source: "environment" });
    });

    test("nothing found gives undefined", () => {
        assert.equal(settingsHome(["--version"], {}, homeFolder()), undefined);
    });
});

// Where Jig runs: the home that `jig` is Pi for, or an ordinary Pi folder with Jig installed by `pi install`.
import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { UPDATE_PI, folderName, installCommand, installMode, signInHint, updateCommand } from "../src/install-mode.ts";

let saved: string | undefined;
beforeEach(() => {
    saved = process.env.JIG_HOME;
    delete process.env.JIG_HOME;
});
afterEach(() => {
    if (saved === undefined) delete process.env.JIG_HOME;
    else process.env.JIG_HOME = saved;
});

describe("installMode", () => {
    test("the default home, ~/.jig, is the home; Pi's own folders are packages", () => {
        assert.equal(installMode(path.join(homedir(), ".jig")), "home");
        assert.equal(installMode(path.join(homedir(), ".pi", "agent")), "package");
        assert.equal(installMode(path.join(homedir(), ".pi", "jig-agent")), "package");
    });

    test("JIG_HOME moves the home: the named folder is the home and ~/.jig is then an ordinary folder", () => {
        const named = path.join(homedir(), "elsewhere", "my-jig");
        process.env.JIG_HOME = named;
        assert.equal(installMode(named), "home");
        assert.equal(installMode(path.join(homedir(), ".jig")), "package");
    });

    test("the folders are compared as resolved paths: a trailing slash or a dot segment is the same folder", () => {
        const home = path.join(homedir(), ".jig");
        assert.equal(installMode(`${home}${path.sep}`), "home");
        assert.equal(installMode(path.join(homedir(), "x", "..", ".jig")), "home");
        assert.equal(installMode(path.join(homedir(), ".jig-other")), "package");
        assert.equal(installMode(path.join(home, "npm")), "package");
    });

    test("no folder at all is a package, and so is a home that nothing names", () => {
        assert.equal(installMode(""), "package");
        process.env.JIG_HOME = "";
        assert.equal(installMode(""), "package");
    });
});

describe("the words that depend on the mode", () => {
    test("installing a package: jig in the home, pi in a Pi folder", () => {
        assert.equal(installCommand("home", "npm:@acme/provider"), "jig install npm:@acme/provider");
        assert.equal(installCommand("package", "npm:@acme/provider"), "pi install npm:@acme/provider");
    });

    test("moving Jig: jig update in the home, an install of that version in a Pi folder", () => {
        assert.equal(updateCommand("home", "@clawdbuilder/jig", "0.6.0"), "jig update");
        assert.equal(updateCommand("package", "@clawdbuilder/jig", "0.6.0"), "pi install npm:@clawdbuilder/jig@0.6.0");
        assert.equal(updateCommand("package", undefined, "0.6.0"), "pi install npm:@clawdbuilder/jig@0.6.0");
    });

    test("signing in, and the name of the folder", () => {
        assert.equal(
            signInHint("home"),
            "Type /login inside jig to choose one, or run `jig auth login <provider>` in a terminal.",
        );
        assert.equal(signInHint("package"), "Type /login to choose one.");
        assert.equal(folderName("home"), "this Jig home");
        assert.equal(folderName("package"), "this Pi folder");
    });

    test("a Pi that is too old is updated by the person, and Jig says how", () => {
        assert.equal(UPDATE_PI, "Update Pi yourself: npm install -g @earendil-works/pi-coding-agent");
    });
});

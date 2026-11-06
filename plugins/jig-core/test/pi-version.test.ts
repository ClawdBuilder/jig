// The package facts `/jig doctor` reads: versions, the Node.js minimum, and where the package says its repository is,
// which is the only place the reinstall line gets an address from.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
    compareVersions,
    installLocation,
    jigPackage,
    meetsMinimum,
    minimumVersion,
    piRequirement,
    currentPiRequirement,
    reinstallFix,
} from "../src/pi-version.ts";

let home: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-package-"));
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

function packageFile(value: unknown): string {
    const file = path.join(home, "package.json");
    writeFileSync(file, JSON.stringify(value));
    return file;
}

describe("jigPackage", () => {
    test("reads the version, the Node.js range and a repository object", () => {
        const file = packageFile({
            version: "9.9.9",
            engines: { node: ">=22.19.0" },
            repository: { type: "git", url: "git+https://github.com/example/jig.git" },
        });
        assert.deepEqual(jigPackage(file), {
            version: "9.9.9",
            node: ">=22.19.0",
            repository: "git+https://github.com/example/jig.git",
        });
    });

    test("reads a repository written as one string, and leaves it out when there is none", () => {
        assert.equal(
            jigPackage(packageFile({ repository: "git@git.example.com:team/jig.git" })).repository,
            "git@git.example.com:team/jig.git",
        );
        assert.deepEqual(jigPackage(packageFile({ version: "1.0.0" })), { version: "1.0.0" });
        assert.deepEqual(jigPackage(packageFile("not an object")), {});
    });
});

describe("piRequirement", () => {
    test("reads the package's stated Pi minimum and tested version", () => {
        const file = packageFile({
            jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.0" } } },
        });
        assert.deepEqual(piRequirement(file), { minimum: "1.4.0", tested: "1.5.0" });
    });

    test("is undefined when the release does not state a usable pair", () => {
        assert.equal(piRequirement(packageFile({})), undefined);
        assert.equal(piRequirement(packageFile({ jig: { agents: { pi: { minimum: "next" } } } })), undefined);
        assert.deepEqual(currentPiRequirement(packageFile({})), { minimum: "1.4.0", tested: "1.5.0" });
    });
});

describe("installLocation", () => {
    test("keeps the host and path, and drops git+, .git and the scheme", () => {
        assert.equal(installLocation("git+https://github.com/example/jig.git"), "github.com/example/jig");
        assert.equal(installLocation("ssh://git@github.com/example/jig.git"), "github.com/example/jig");
        assert.equal(installLocation("git@git.example.com:team/jig.git"), "git.example.com/team/jig");
        assert.equal(installLocation("github:example/jig"), "github.com/example/jig");
        assert.equal(installLocation("github.com/example/jig"), "github.com/example/jig");
    });

    test("is undefined for a missing or unusable repository", () => {
        for (const value of [undefined, "", "   ", "example/jig", "https://github.com"]) {
            assert.equal(installLocation(value), undefined);
        }
    });
});

describe("reinstallFix", () => {
    test("names the npm package, not the repository", () => {
        assert.equal(
            reinstallFix("git+https://github.com/example/jig.git"),
            "Reinstall Jig: pi install npm:@clawdbuilder/jig",
        );
    });

    test("is plain words when there is no repository to name", () => {
        assert.equal(reinstallFix(undefined), "Reinstall Jig the way you installed it.");
        assert.equal(reinstallFix("  "), "Reinstall Jig the way you installed it.");
    });
});

describe("versions", () => {
    test("takes the first three numbers of a range, and compares them", () => {
        assert.equal(minimumVersion(">=22.19.0"), "22.19.0");
        assert.equal(minimumVersion("^22.19"), "22.19.0");
        assert.equal(compareVersions("22.19.0", "22.19.0"), 0);
        assert.ok(compareVersions("22.18.9", "22.19.0") < 0);
        assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
        assert.equal(meetsMinimum("22.19.0", "22.19.0"), true);
        assert.equal(meetsMinimum("22.18.0", "22.19.0"), false);
        assert.equal(meetsMinimum(undefined, "22.19.0"), false);
    });
});

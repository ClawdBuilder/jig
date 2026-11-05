// Where Pi 1.5 puts an installed package, checked against real folder layouts: git clones per scope, npm packages, local
// folders, and the entries that are listed but whose files are not there.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { gitFolder, parseGitSource, parseNpmSource, readPackages } from "../src/cli/packages.ts";
import { installLocation, npmInstall } from "../src/pi-version.ts";

let root: string;
let agent: string;
let work: string;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-packages-"));
    agent = path.join(root, "agent");
    work = path.join(root, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const settings = (file: string, packages: unknown[]): void => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ packages }));
};
const mkPackage = (folder: string, name: string, version = "1.0.0"): void => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, version }));
};

describe("a git source, as Pi parses it", () => {
    test("the forms people install", () => {
        const cases: Array<[string, { host: string; path: string; ref?: string }]> = [
            ["git:github.com/Dev-Mriganka/jig", { host: "github.com", path: "Dev-Mriganka/jig" }],
            ["git:github.com/Dev-Mriganka/jig@v0.4.0", { host: "github.com", path: "Dev-Mriganka/jig", ref: "v0.4.0" }],
            ["https://github.com/Dev-Mriganka/jig", { host: "github.com", path: "Dev-Mriganka/jig" }],
            ["https://github.com/Dev-Mriganka/jig.git", { host: "github.com", path: "Dev-Mriganka/jig" }],
            ["http://git.example.test/team/repo", { host: "git.example.test", path: "team/repo" }],
            ["ssh://git@github.com/Dev-Mriganka/jig", { host: "github.com", path: "Dev-Mriganka/jig" }],
            ["git://github.com/Dev-Mriganka/jig", { host: "github.com", path: "Dev-Mriganka/jig" }],
            ["git:git@github.com:Dev-Mriganka/jig", { host: "github.com", path: "Dev-Mriganka/jig" }],
            [
                "git:git@github.com:Dev-Mriganka/jig@v0.4.0",
                { host: "github.com", path: "Dev-Mriganka/jig", ref: "v0.4.0" },
            ],
            ["git:gitlab.com/team/sub/repo", { host: "gitlab.com", path: "team/sub/repo" }],
        ];
        for (const [source, expected] of cases) assert.deepEqual(parseGitSource(source), expected, source);
    });

    test("what is not a git source", () => {
        for (const source of [
            "git:",
            "git:no-slash",
            "git:github.com/onlyone",
            "ftp://github.com/a/b",
            "https://github.com",
            "git:host/../repo",
        ]) {
            assert.equal(parseGitSource(source), undefined, source);
        }
    });

    test("the folder drops .git and the ref", () => {
        assert.equal(gitFolder("/a", "github.com", "team/repo"), "/a/git/github.com/team/repo");
    });
});

describe("an npm source", () => {
    test("the package name, with or without a version and a scope", () => {
        assert.deepEqual(parseNpmSource("npm:jig"), { name: "jig" });
        assert.deepEqual(parseNpmSource("npm:jig@0.4.0"), { name: "jig" });
        assert.deepEqual(parseNpmSource("npm:@acme/jig"), { name: "@acme/jig" });
        assert.deepEqual(parseNpmSource("npm:@acme/jig@0.4.0"), { name: "@acme/jig" });
        assert.equal(parseNpmSource("jig"), undefined);
    });
});

describe("the packages Pi lists", () => {
    test("user scope: git clone under git/<host>/<path>, npm under npm/node_modules, local relative to the agent folder", () => {
        mkPackage(path.join(agent, "git/github.com/team/repo"), "jig");
        mkPackage(path.join(agent, "npm/node_modules/company"), "company");
        mkPackage(path.join(agent, "checkout"), "local-one");
        settings(path.join(agent, "settings.json"), ["git:github.com/team/repo", "npm:company@1.0.0", "./checkout"]);
        const { listed } = readPackages(agent, work);
        assert.deepEqual(
            listed.map((entry) => [entry.source, entry.scope, entry.folder, entry.problem]),
            [
                ["git:github.com/team/repo", "user", path.join(agent, "git/github.com/team/repo"), undefined],
                ["npm:company@1.0.0", "user", path.join(agent, "npm/node_modules/company"), undefined],
                ["./checkout", "user", path.join(agent, "checkout"), undefined],
            ],
        );
    });

    test("project scope: settings and packages under <cwd>/.pi", () => {
        mkPackage(path.join(work, ".pi/git/github.com/team/company"), "company");
        settings(path.join(work, ".pi/settings.json"), ["git:github.com/team/company"]);
        const { listed } = readPackages(agent, work);
        assert.deepEqual(listed, [
            {
                source: "git:github.com/team/company",
                scope: "project",
                folder: path.join(work, ".pi/git/github.com/team/company"),
            },
        ]);
    });

    test("a listed entry whose folder is missing says so, with where it should be", () => {
        settings(path.join(agent, "settings.json"), ["git:github.com/Dev-Mriganka/jig"]);
        const { listed } = readPackages(agent, work);
        assert.equal(listed.length, 1);
        assert.match(listed[0]?.problem ?? "", /Pi lists it, but its files are not there/);
        assert.match(listed[0]?.problem ?? "", /git\/github\.com\/Dev-Mriganka\/jig/);
    });

    test("the same folder listed in both scopes is loaded once", () => {
        const folder = path.join(agent, "one");
        mkPackage(folder, "one");
        settings(path.join(agent, "settings.json"), [folder]);
        settings(path.join(work, ".pi/settings.json"), [folder]);
        assert.equal(readPackages(agent, work).listed.length, 1);
    });

    test("an entry whose source cannot be read is named, and does not load", () => {
        settings(path.join(agent, "settings.json"), ["git:github.com/onlyone"]);
        const { listed } = readPackages(agent, work);
        assert.equal(listed.length, 1);
        assert.match(listed[0]?.problem ?? "", /cannot be read/);
    });

    test("settings that are not JSON are reported, not thrown", () => {
        writeFileSync(path.join(agent, "settings.json"), "{ not json");
        const { listed, settingsProblems } = readPackages(agent, work);
        assert.deepEqual(listed, []);
        assert.equal(settingsProblems.length, 1);
        assert.match(settingsProblems[0]?.problem ?? "", /JSON/);
    });
});

describe("the package manifest", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
        name: string;
        private?: boolean;
        publishConfig?: { access?: string };
        files?: string[];
        peerDependencies: Record<string, string>;
        peerDependenciesMeta: Record<string, { optional?: boolean }>;
        devDependencies: Record<string, string>;
        repository?: unknown;
    };

    test("it is the scoped npm package, publishable, with a files allowlist", () => {
        assert.equal(pkg.name, "@dev-mriganka/jig");
        assert.equal(pkg.private, undefined);
        assert.equal(pkg.publishConfig?.access, "public");
        assert.ok((pkg.files ?? []).includes("bin/"));
        assert.ok((pkg.files ?? []).includes("plugins/*/src/"));
        assert.equal(npmInstall(pkg.name), "npm:@dev-mriganka/jig");
    });

    test("Pi's four packages are optional peers, and exact dev dependencies", () => {
        for (const name of [
            "@earendil-works/pi-ai",
            "@earendil-works/pi-coding-agent",
            "@earendil-works/pi-tui",
            "typebox",
        ]) {
            assert.ok(pkg.peerDependencies[name], `${name} is a peer`);
            assert.equal(pkg.peerDependenciesMeta[name]?.optional, true, `${name} is optional`);
            assert.match(pkg.devDependencies[name] ?? "", /^\d+\.\d+\.\d+$/, `${name} is pinned for development`);
        }
    });

    test("the repository names the exact install line the doctor prints", () => {
        const repository =
            typeof pkg.repository === "string" ? pkg.repository : (pkg.repository as { url?: string } | undefined)?.url;
        assert.equal(installLocation(repository), "github.com/Dev-Mriganka/jig");
    });
});

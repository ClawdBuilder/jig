// Choosing a profile: the checks of the two sections, folder and remote patterns, reading the origin remote from .git/config
// (no process, no network), and the order of the choice. Pure; the effects of the choice are in profile-state.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
    chooseProfile,
    globToRegExp,
    matchFolder,
    matchRemote,
    normalizeRemote,
    originOf,
    profileEntries,
    validateProfileSection,
    validateProfilesSection,
} from "../src/profiles.ts";
import type { ChooseInput, ProfileEntry } from "../src/profiles.ts";

let root: string;
beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-profiles-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function repo(folder: string, url: string | undefined): string {
    const dir = path.join(root, folder);
    mkdirSync(path.join(dir, ".git"), { recursive: true });
    const remote =
        url === undefined ? "" : `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
    writeFileSync(
        path.join(dir, ".git", "config"),
        `[core]\n\tbare = false\n${remote}[branch "main"]\n\tremote = origin\n`,
    );
    return dir;
}

describe("the sections", () => {
    test("a good profiles section has no errors, and an entry needs a plugin", () => {
        assert.deepEqual(
            validateProfilesSection({
                acme: { plugin: "jig-acme", when: { folders: ["~/work/acme/**"], remotes: ["github.com:acme-org/*"] } },
            }),
            [],
        );
        assert.match(validateProfilesSection({ acme: {} }).join(), /acme\.plugin must be the name/);
        assert.match(validateProfilesSection([]).join(), /must be an object/);
    });

    test("unknown fields, bad names and bad pattern lists are named", () => {
        const errors = validateProfilesSection({
            acme: { plugin: "jig-acme", extra: 1, when: { folders: "x", remotes: [1], cwd: [] } },
            auto: { plugin: "jig-acme" },
            "bad name": { plugin: "jig-acme" },
        }).join("\n");
        assert.match(errors, /acme\.extra: unknown field/);
        assert.match(errors, /acme\.when\.folders must be a list/);
        assert.match(errors, /acme\.when\.remotes must be a list/);
        assert.match(errors, /acme\.when\.cwd: unknown field/);
        assert.match(errors, /profiles\.auto/);
        assert.match(errors, /profiles\.bad\?name|profiles\.bad name/);
    });

    test("profile is auto, none or a name", () => {
        for (const good of ["auto", "none", "acme", "work-2"]) assert.deepEqual(validateProfileSection(good), []);
        for (const bad of [1, "", "a b", null, ["acme"]]) assert.equal(validateProfileSection(bad).length, 1);
    });

    test("profileEntries keeps the file's order", () => {
        const entries = profileEntries({ b: { plugin: "p2" }, a: { plugin: "p1", when: { folders: ["/x"] } } });
        assert.deepEqual(
            entries.map((entry) => entry.label),
            ["b", "a"],
        );
        assert.deepEqual(entries[1]?.folders, ["/x"]);
    });
});

describe("patterns", () => {
    test("* stays in one segment, ** crosses them, and /** also matches the folder itself", () => {
        assert.ok(globToRegExp("/w/*/x").test("/w/a/x"));
        assert.ok(!globToRegExp("/w/*/x").test("/w/a/b/x"));
        assert.ok(globToRegExp("/w/**/x").test("/w/a/b/x"));
        assert.ok(globToRegExp("/w/acme/**").test("/w/acme"));
        assert.ok(globToRegExp("/w/acme/**").test("/w/acme/a/b"));
        assert.ok(!globToRegExp("/w/acme/**").test("/w/acme-other"));
    });

    test("a folder pattern expands ~ and matches the folder and what is below it", () => {
        assert.equal(matchFolder(["~/work/acme/**"], "/home/u/work/acme/orders", "/home/u"), "~/work/acme/**");
        assert.equal(matchFolder(["~/work/acme/**"], "/home/u/work/acme", "/home/u"), "~/work/acme/**");
        assert.equal(matchFolder(["~/work/acme/**"], "/home/u/work/other", "/home/u"), undefined);
        assert.equal(matchFolder(["/x/**"], "", "/home/u"), undefined);
    });

    test("remotes are normalized from ssh, scp-like and https forms", () => {
        assert.equal(normalizeRemote("git@github.com:acme-org/orders.git"), "github.com:acme-org/orders");
        assert.equal(normalizeRemote("https://user@github.com/Acme-Org/orders.git"), "github.com:acme-org/orders");
        assert.equal(normalizeRemote("ssh://git@git.example.com:2222/team/app"), "git.example.com:team/app");
        assert.equal(normalizeRemote("/srv/git/local.git"), undefined);
        assert.equal(normalizeRemote(""), undefined);
    });

    test("a remote pattern matches without case and * stays in the repository name", () => {
        assert.equal(matchRemote(["GitHub.com:acme-org/*"], "github.com:acme-org/orders"), "GitHub.com:acme-org/*");
        assert.equal(matchRemote(["github.com:acme-org/*"], "github.com:acme-org/a/b"), undefined);
        assert.equal(matchRemote(["github.com:acme-org/*"], undefined), undefined);
    });
});

describe("reading the origin remote", () => {
    test("from .git/config, from a subfolder, and not from a repository without one", () => {
        const dir = repo("orders", "git@github.com:acme-org/orders.git");
        mkdirSync(path.join(dir, "src", "deep"), { recursive: true });
        assert.equal(originOf(path.join(dir, "src", "deep")), "git@github.com:acme-org/orders.git");
        assert.equal(originOf(repo("bare", undefined)), undefined);
        assert.equal(originOf(path.join(root, "nowhere")), undefined);
        assert.equal(originOf(""), undefined);
    });

    test("a worktree reads the shared config through its .git file and commondir", () => {
        const main = repo("main", "https://github.com/acme-org/orders.git");
        const gitdir = path.join(main, ".git", "worktrees", "feature");
        mkdirSync(gitdir, { recursive: true });
        writeFileSync(path.join(gitdir, "commondir"), "../..\n");
        const work = path.join(root, "feature");
        mkdirSync(work);
        writeFileSync(path.join(work, ".git"), `gitdir: ${gitdir}\n`);
        assert.equal(originOf(work), "https://github.com/acme-org/orders.git");
    });

    test("only the origin remote counts", () => {
        const dir = path.join(root, "two");
        mkdirSync(path.join(dir, ".git"), { recursive: true });
        writeFileSync(
            path.join(dir, ".git", "config"),
            '[remote "upstream"]\n\turl = https://github.com/other/x.git\n[remote "origin"]\n\turl = https://github.com/acme-org/y.git\n',
        );
        assert.equal(originOf(dir), "https://github.com/acme-org/y.git");
    });
});

describe("the choice", () => {
    const profiles: ProfileEntry[] = [
        { label: "acme", plugin: "jig-acme", folders: ["/work/acme/**"], remotes: ["github.com:acme-org/*"] },
        { label: "globex", plugin: "jig-globex", folders: ["/work/globex/**"], remotes: [] },
    ];
    const base: ChooseInput = {
        profiles,
        setting: "auto",
        session: undefined,
        registered: ["jig-acme", "jig-globex"],
        cwd: "/elsewhere",
        home: "/home/u",
    };

    test("auto: a matching folder wins, and says which pattern", () => {
        const picked = chooseProfile({ ...base, cwd: "/work/globex/app" });
        assert.equal(picked.profile, "globex");
        assert.equal(picked.reason, "folder");
        assert.match(picked.why, /\/work\/globex\/\*\*/);
    });

    test("auto: a matching remote chooses when no folder does", () => {
        const dir = repo("anywhere", "git@github.com:acme-org/orders.git");
        const picked = chooseProfile({ ...base, cwd: dir });
        assert.equal(picked.profile, "acme");
        assert.equal(picked.reason, "remote");
        assert.match(picked.why, /github\.com:acme-org\/orders/);
    });

    test("auto: the first profile in the file that matches wins", () => {
        const both = [profiles[1] as ProfileEntry, { ...(profiles[0] as ProfileEntry), folders: ["/work/**"] }];
        assert.equal(chooseProfile({ ...base, profiles: both, cwd: "/work/globex/x" }).profile, "globex");
    });

    test("auto: no match is no company, even when one plugin is loaded", () => {
        const picked = chooseProfile({ ...base, registered: ["jig-acme"] });
        assert.equal(picked.reason, "none");
        assert.equal(picked.plugin, undefined);
    });

    test("auto: a profile whose plugin is not loaded is skipped", () => {
        const picked = chooseProfile({ ...base, registered: ["jig-globex"], cwd: "/work/acme/x" });
        assert.equal(picked.reason, "none");
    });

    test("no profiles section: the only company plugin is active, as before profiles existed", () => {
        const picked = chooseProfile({ ...base, profiles: undefined, registered: ["jig-acme"] });
        assert.equal(picked.reason, "sole");
        assert.equal(picked.plugin, "jig-acme");
    });

    test("no profiles section and two or no company plugins: no company", () => {
        assert.equal(chooseProfile({ ...base, profiles: undefined }).reason, "none");
        assert.equal(chooseProfile({ ...base, profiles: undefined, registered: [] }).reason, "none");
    });

    test("an empty profiles section does not fall back to the sole company", () => {
        assert.equal(chooseProfile({ ...base, profiles: [], registered: ["jig-acme"] }).reason, "none");
    });

    test("an explicit profile wins over a matching folder; none turns the company off", () => {
        const picked = chooseProfile({ ...base, setting: "acme", cwd: "/work/globex/app" });
        assert.equal(picked.profile, "acme");
        assert.equal(picked.reason, "explicit");
        const off = chooseProfile({ ...base, setting: "none", cwd: "/work/globex/app" });
        assert.equal(off.plugin, undefined);
        assert.equal(off.reason, "explicit");
    });

    test("an explicit name that is not a profile, or whose plugin is not loaded, activates nothing and says why", () => {
        assert.match(chooseProfile({ ...base, setting: "nope" }).why, /no profile "nope"/);
        const unloaded = chooseProfile({ ...base, setting: "acme", registered: [] });
        assert.equal(unloaded.plugin, undefined);
        assert.match(unloaded.why, /jig-acme" is not loaded/);
    });

    test("the session's choice wins over jig.json", () => {
        const picked = chooseProfile({ ...base, setting: "globex", session: "acme" });
        assert.equal(picked.profile, "acme");
        assert.equal(picked.reason, "session");
        assert.equal(chooseProfile({ ...base, session: "none" }).plugin, undefined);
    });
});

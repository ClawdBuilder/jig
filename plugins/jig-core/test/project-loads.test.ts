// What Pi loads from a project at its next start is guarded for Pi's file tools as it already was for bash: one shared
// table, the same scope (the working folder and its parents below home), matched by path shape and not by existence.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { checkFileTool, defaultProtectedPaths } from "../src/protected-paths.ts";
import { PI_PROJECT_PATHS, projectFoldersBelowHome } from "../src/kit/pi-project-paths.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
let home: string;
let work: string;
let agentDir: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-project-loads-"));
    work = path.join(home, "repo");
    agentDir = path.join(home, ".pi/agent");
    mkdirSync(work, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const context = (cwd: string = work, platform?: NodeJS.Platform) => ({
    entries: defaultProtectedPaths({ agentDir, home, cwd, ...(platform === undefined ? {} : { platform }) }),
    cwd,
    home,
    ...(platform === undefined ? {} : { platform }),
});
const refusal = (target: string, cwd: string = work, platform?: NodeJS.Platform): string | undefined =>
    checkFileTool("write", { path: target }, context(cwd, platform))?.reason;

describe("the project files Pi loads", () => {
    test("every one is refused, existing or not, and with .pi absent", () => {
        for (const item of PI_PROJECT_PATHS) {
            assert.match(refusal(path.join(work, item)) ?? "", /refused/, `${item}: absent`);
            const target = path.join(work, item);
            mkdirSync(path.dirname(target), { recursive: true });
            writeFileSync(target, "x");
            assert.match(refusal(target) ?? "", /Pi loads this at its next start/, `${item}: existing`);
            // A fresh project whose .pi folder does not exist at all.
            const fresh = path.join(home, "fresh");
            mkdirSync(fresh, { recursive: true });
            assert.match(refusal(path.join(fresh, item), fresh) ?? "", /refused/, `${item}: no .pi`);
        }
    });

    test("the working folder's parents are guarded too, and a child's .pi is not", () => {
        const sub = path.join(work, "sub");
        mkdirSync(sub, { recursive: true });
        assert.match(refusal(path.join(work, ".pi/settings.json"), sub) ?? "", /refused/, "parent from sub");
        assert.match(refusal("../.pi/settings.json", sub) ?? "", /refused/, "../ folded");
        // Matching the sandbox: a folder below the working folder is not a project folder for this check.
        assert.equal(refusal(path.join(sub, ".pi/settings.json"), work), undefined);
        // But it is when Pi runs there.
        assert.match(refusal(path.join(sub, ".pi/settings.json"), sub) ?? "", /refused/, "its own");
    });

    test("a symlinked working folder is followed, and a case-only difference does not slip past", () => {
        const link = path.join(home, "link");
        symlinkSync(work, link);
        assert.match(refusal(path.join(link, ".pi/settings.json"), link) ?? "", /refused/, "symlink");
        assert.match(refusal(path.join(work, ".PI/Settings.JSON"), work, "darwin") ?? "", /refused/, "macOS case");
        assert.match(refusal(path.join(work, ".Pi\\Settings.json"), work, "win32") ?? "", /refused/, "Windows case");
    });

    test("normal project files are untouched, including a file named settings.json outside .pi", () => {
        for (const allowed of ["notes.txt", "settings.json", "notes/settings.json", ".github/settings.json"]) {
            assert.equal(refusal(path.join(work, allowed)), undefined, allowed);
        }
        assert.equal(
            checkFileTool("read", { path: path.join(work, ".pi/settings.json") }, context())?.reason,
            undefined,
        );
    });

    test("the sandbox's lock and the file tools read one table, and it covers Pi's trust list", () => {
        const trust = path.join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/core/trust-manager.js");
        assert.ok(existsSync(trust), "Pi's source is installed for the tests");
        const source = readFileSync(trust, "utf8");
        const list = /TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES\s*=\s*\[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
        const names = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]).filter((name) => name !== undefined);
        assert.ok(names.length >= 8, "Pi's trust list was found");
        for (const name of names) assert.ok(PI_PROJECT_PATHS.includes(`.pi/${name}`), `Pi's ${name} is in the table`);
        for (const extra of [".pi/git", ".pi/npm", ".agents"]) assert.ok(PI_PROJECT_PATHS.includes(extra), extra);
        // The folders the sandbox already walks: the working folder and its parents, stopping before home.
        assert.deepEqual(projectFoldersBelowHome(path.join(home, "a/b"), home), [
            path.join(home, "a/b"),
            path.join(home, "a"),
        ]);
    });
});

describe("the sandbox's locks and the file tools' guards are one table", () => {
    test("every locked and ask-first path on the bash side has a file-tool entry", async () => {
        const { LOCKED_IN_HOME, LOCKED_ON_MAC, LOCKED_IN_PROJECT, ASK_FIRST } = await import(
            "../../jig-sandbox/src/lists.ts"
        );
        const { RUNS_LATER } = await import("../src/kit/runs-later.ts");
        const expand = (listed: string): string => path.join(home, listed.replace(/^~\//, ""));
        const entries = defaultProtectedPaths({ agentDir, home, cwd: work });
        const has = (target: string): boolean =>
            entries.some((entry) => entry.path === target || entry.path === path.resolve(target));
        for (const item of [...LOCKED_IN_HOME, ...ASK_FIRST]) assert.ok(has(expand(item.path)), item.path);
        const macEntries = defaultProtectedPaths({ agentDir, home, cwd: work, platform: "darwin" });
        for (const item of LOCKED_ON_MAC) {
            assert.ok(
                macEntries.some((entry) => entry.path === expand(item.path)),
                item.path,
            );
        }
        // Repository scope: the working folder is a repository, and each relative entry is guarded there.
        mkdirSync(path.join(work, ".git"), { recursive: true });
        const repoEntries = defaultProtectedPaths({ agentDir, home, cwd: work });
        for (const item of LOCKED_IN_PROJECT) {
            assert.ok(
                repoEntries.some((entry) => entry.path === path.join(work, item.path)),
                item.path,
            );
        }
    });
});

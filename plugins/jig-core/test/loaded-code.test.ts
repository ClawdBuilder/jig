// The code Pi loads on its own at the next start: the local packages and extensions that its settings name, and the files of the
// extensions it has loaded, are guarded paths. Pi's own rules are in the header of src/loaded-code.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { isLocalSource, loadedCodePaths, loadedExtensionFiles, localSources, resolveFrom } from "../src/loaded-code.ts";
import { checkFileTool, defaultProtectedPaths } from "../src/protected-paths.ts";
import { start } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import { tempState } from "./support/state.ts";

const HOME = "/home/me";
const AGENT = `${HOME}/.pi/agent`;
const CWD = `${HOME}/work/orders`;

/** Files that are not on disk, by path. */
const files = (map: Record<string, unknown>) => (file: string) =>
    file in map ? (typeof map[file] === "string" ? (map[file] as string) : JSON.stringify(map[file])) : undefined;

const paths = (found: ReturnType<typeof loadedCodePaths>) => found.map((entry) => [entry.path, entry.shown]);

describe("what is local", () => {
    test("everything but the sources Pi knows by their prefix", () => {
        for (const source of ["./tools", "../shared/ext", "/opt/ext", "~/ext", "ext", "file:///opt/ext", "C:\\ext"]) {
            assert.equal(isLocalSource(source), true, source);
        }
        for (const source of [
            "npm:@acme/pi-tools",
            "git:github.com/acme/tools",
            "github:acme/tools",
            "https://example.com/tools.git",
            "http://example.com/tools.git",
            "ssh://git@example.com/tools.git",
            "builtin:mcp",
            "",
            "   ",
        ]) {
            assert.equal(isLocalSource(source), false, JSON.stringify(source));
        }
    });

    test("a path is read as Pi reads it: ~, file:// and a relative path from the folder it is given", () => {
        assert.equal(resolveFrom("./tools", AGENT, HOME), `${AGENT}/tools`);
        assert.equal(resolveFrom("../shared", `${CWD}/.pi`, HOME), `${CWD}/shared`);
        assert.equal(resolveFrom("~/ext", AGENT, HOME), `${HOME}/ext`);
        assert.equal(resolveFrom("/opt/ext/../tools", AGENT, HOME), "/opt/tools");
        assert.equal(resolveFrom("file:///opt/ext", AGENT, HOME), "/opt/ext");
        assert.equal(resolveFrom("  ./tools  ", AGENT, HOME), `${AGENT}/tools`, "Pi trims it");
        assert.equal(resolveFrom("", AGENT, HOME), undefined);
        assert.equal(resolveFrom("x".repeat(2000), AGENT, HOME), undefined);
    });

    test("the sources of a settings file: packages as text or as an object, and the plain entries of extensions", () => {
        assert.deepEqual(
            localSources(
                JSON.stringify({
                    packages: [
                        "./a",
                        { source: "./b", extensions: ["x"] },
                        "npm:pkg",
                        { source: "git:github.com/o/r" },
                        { nothing: true },
                        42,
                        null,
                    ],
                    extensions: ["./one.ts", "!./off.ts", "+./on.ts", "-./gone.ts", "./glob/*.ts", "./q?.ts", 7],
                }),
            ),
            { packages: ["./a", "./b"], extensions: ["./one.ts"] },
        );
    });

    test("a settings file that is not JSON, or not an object, names nothing", () => {
        for (const text of ["{ nope", "[]", "null", '"x"', "", '{ "packages": "./a" }']) {
            assert.deepEqual(localSources(text), { packages: [], extensions: [] }, text);
        }
    });
});

describe("the paths guarded", () => {
    const input = (map: Record<string, unknown>, over: Partial<Parameters<typeof loadedCodePaths>[0]> = {}) => ({
        agentDir: AGENT,
        cwd: CWD,
        home: HOME,
        read: files(map),
        ...over,
    });

    test("a relative and an absolute local package of the user's settings, a relative one from the agent folder", () => {
        const found = loadedCodePaths(
            input({ [`${AGENT}/settings.json`]: { packages: ["./tools", "/opt/pi/ext", { source: "~/code/pkg" }] } }),
        );
        assert.deepEqual(paths(found), [
            [`${AGENT}/tools`, "~/.pi/agent/tools (a package in settings.json)"],
            ["/opt/pi/ext", "/opt/pi/ext (a package in settings.json)"],
            [`${HOME}/code/pkg`, "~/code/pkg (a package in settings.json)"],
        ]);
        assert.ok(found.every((entry) => entry.kind === "guarded" && entry.source === "default"));
    });

    test("a project's settings: a relative package starts from .pi, not from the working folder", () => {
        const found = loadedCodePaths(
            input({ [`${CWD}/.pi/settings.json`]: { packages: ["../tools", "./local", "/opt/x"] } }),
        );
        assert.deepEqual(paths(found), [
            [`${CWD}/tools`, "~/work/orders/tools (a package in .pi/settings.json)"],
            [`${CWD}/.pi/local`, "~/work/orders/.pi/local (a package in .pi/settings.json)"],
            ["/opt/x", "/opt/x (a package in .pi/settings.json)"],
        ]);
    });

    test("both files at once, and a package that is a single file", () => {
        const found = loadedCodePaths(
            input({
                [`${AGENT}/settings.json`]: { packages: ["~/code/pkg"] },
                [`${CWD}/.pi/settings.json`]: { packages: ["../ext/one.ts"] },
            }),
        );
        assert.deepEqual(
            found.map((entry) => entry.path),
            [`${HOME}/code/pkg`, `${CWD}/ext/one.ts`],
        );
    });

    test("a git and an npm package add nothing: they are installed in the agent folder, which is guarded whole", () => {
        const found = loadedCodePaths(
            input({
                [`${AGENT}/settings.json`]: {
                    packages: ["git:github.com/acme/jig", "npm:@acme/pi-tools", "https://example.com/p.git"],
                },
            }),
        );
        assert.deepEqual(found, []);
    });

    test("the plain extensions of the settings are guarded, and the entries that only filter are not", () => {
        const found = loadedCodePaths(
            input({
                [`${AGENT}/settings.json`]: { extensions: ["./mine.ts", "!./off.ts", "./many/*.ts"] },
                [`${CWD}/.pi/settings.json`]: { extensions: ["../ext"] },
            }),
        );
        assert.deepEqual(paths(found), [
            [`${AGENT}/mine.ts`, "~/.pi/agent/mine.ts (an extension in settings.json)"],
            [`${CWD}/ext`, "~/work/orders/ext (an extension in .pi/settings.json)"],
        ]);
    });

    test("a path that is not there yet is guarded too: a file made there before the next start would be loaded", () => {
        const [entry] = loadedCodePaths(input({ [`${AGENT}/settings.json`]: { packages: ["/opt/not/made/yet"] } }));
        assert.equal(entry?.path, "/opt/not/made/yet");
    });

    test("a package that would guard the home folder, a folder above it or the root is ignored", () => {
        const found = loadedCodePaths(
            input({ [`${AGENT}/settings.json`]: { packages: ["~", "/home", "/", "~/code/ok"] } }),
        );
        assert.deepEqual(
            found.map((entry) => entry.path),
            [`${HOME}/code/ok`],
        );
    });

    test("no agent folder, no working folder, or no settings file: nothing, and no error", () => {
        assert.deepEqual(loadedCodePaths(input({})), []);
        assert.deepEqual(
            loadedCodePaths(input({ [`${AGENT}/settings.json`]: { packages: ["/opt/a"] } }, { agentDir: "" })),
            [],
        );
        assert.deepEqual(
            loadedCodePaths(input({ [`${CWD}/.pi/settings.json`]: { packages: ["/opt/a"] } }, { cwd: "" })),
            [],
        );
    });

    test("a package listed twice is listed once", () => {
        const found = loadedCodePaths(
            input({
                [`${AGENT}/settings.json`]: { packages: ["/opt/a", "/opt/a/"] },
                [`${CWD}/.pi/settings.json`]: { packages: ["/opt/a"] },
            }),
        );
        assert.equal(found.length, 1);
    });

    test("the extensions Pi loaded: a file outside every folder guarded already is added, the rest are left out", () => {
        const found = loadedCodePaths(
            input(
                { [`${AGENT}/settings.json`]: { packages: ["/opt/pkg"] } },
                {
                    extensionFiles: [
                        `${HOME}/ext/mine.ts`,
                        `${AGENT}/extensions/theirs.ts`,
                        "/opt/pkg/src/index.ts",
                        "/opt/pkg",
                    ],
                },
            ),
        );
        assert.deepEqual(paths(found), [
            ["/opt/pkg", "/opt/pkg (a package in settings.json)"],
            [`${HOME}/ext/mine.ts`, "~/ext/mine.ts (an extension Pi loaded)"],
        ]);
    });
});

describe("the extensions Pi says it loaded", () => {
    const info = (file: unknown) => ({ sourceInfo: { path: file } });

    test("the files of the tools and commands they registered, once each; built-in and inline ones have no file", () => {
        const pi = {
            getAllTools: () => [
                info("/opt/a.ts"),
                info("builtin:read"),
                info("/opt/a.ts"),
                info("<inline:x>"),
                info(5),
            ],
            getCommands: () => [info("/opt/b.ts"), { name: "no source" }],
        };
        assert.deepEqual(loadedExtensionFiles(pi as never), ["/opt/a.ts", "/opt/b.ts"]);
    });

    test("Pi refusing while extensions load, or having no such call, gives none", () => {
        const refuse = () => {
            throw new Error("Extension runtime not initialized");
        };
        assert.deepEqual(loadedExtensionFiles({ getAllTools: refuse, getCommands: refuse } as never), []);
        assert.deepEqual(loadedExtensionFiles({} as never), []);
    });
});

describe("what the file tools do with them", () => {
    const entries = [
        ...defaultProtectedPaths({ agentDir: AGENT, home: HOME, env: {} }),
        ...loadedCodePaths({
            agentDir: AGENT,
            cwd: CWD,
            home: HOME,
            read: files({ [`${AGENT}/settings.json`]: { packages: [`${CWD}/tools`, "/opt/pkg"] } }),
        }),
    ];
    const check = (tool: string, target: string) =>
        checkFileTool(tool, { path: target }, { entries, cwd: CWD, home: HOME, platform: "linux" });

    test("a package inside the working folder can be read and searched, and not written", () => {
        for (const tool of ["read", "grep", "find", "ls"])
            assert.equal(check(tool, `${CWD}/tools/index.ts`), undefined, tool);
        for (const tool of ["write", "edit"]) {
            assert.equal(
                check(tool, `${CWD}/tools/index.ts`)?.reason,
                `${tool} is refused: ~/work/orders/tools (a package in settings.json) is guarded: the file tools can read it but not write it`,
            );
        }
        assert.ok(check("write", `${CWD}/tools/new/file.ts`), "a new file in it");
        assert.ok(check("write", "/opt/pkg/src/a.ts"), "a package outside the working folder");
    });

    test("the rest of the working folder is writable", () => {
        assert.equal(check("write", `${CWD}/src/main.ts`), undefined);
        assert.equal(check("write", `${CWD}/tools-notes.md`), undefined, "a name that only starts the same");
    });
});

describe("in a session", () => {
    let root: string;
    let project: string;
    let h: Harness | undefined;
    const state = tempState();
    beforeEach(() => state.start());
    afterEach(async () => {
        await h?.shutdown();
        h = undefined;
        state.stop();
    });
    before(() => {
        root = realpathSync(mkdtempSync(path.join(tmpdir(), "jig-loaded-")));
        project = path.join(root, "orders");
        mkdirSync(path.join(project, ".pi"), { recursive: true });
        mkdirSync(path.join(project, "tools"), { recursive: true });
        mkdirSync(path.join(project, "src"), { recursive: true });
        writeFileSync(path.join(project, "tools", "index.ts"), "export default () => {};\n");
        writeFileSync(
            path.join(project, ".pi", "settings.json"),
            JSON.stringify({ packages: ["../tools", "npm:something"] }),
        );
        // A link to a package that lies elsewhere: a write through the link reaches the package.
        mkdirSync(path.join(root, "elsewhere", "pkg"), { recursive: true });
        symlinkSync(path.join(root, "elsewhere", "pkg"), path.join(project, "linked"));
    });
    after(() => rmSync(root, { recursive: true, force: true }));

    const settings = (packages: string[]) => () => {
        writeFileSync(
            path.join(process.env.PI_CODING_AGENT_DIR as string, "settings.json"),
            JSON.stringify({ packages }),
        );
    };

    test("the user's and the project's packages are listed in protectedPaths, and /jig rules says where each came from", async () => {
        h = await start({ cwd: project, plugins: settings([path.join(root, "elsewhere", "pkg")]) });
        const listed = h.api.protectedPaths.list().filter((entry) => entry.shown.includes("(a package in"));
        assert.deepEqual(
            listed.map((entry) => [entry.kind, entry.source, entry.shown.replace(root, "ROOT")]),
            [
                ["guarded", "default", "ROOT/elsewhere/pkg (a package in settings.json)"],
                ["guarded", "default", "ROOT/orders/tools (a package in .pi/settings.json)"],
            ],
        );
    });

    test("a write to a package is refused by the gate, a read is allowed, and the rest of the project is writable", async () => {
        h = await start({ cwd: project, plugins: settings([]) });
        const target = path.join(project, "tools", "index.ts");
        const write = await h.gate({ tool: "write", input: { path: target, content: "x" } });
        assert.equal(write?.block, true);
        assert.match(write?.reason ?? "", /tools \(a package in \.pi\/settings\.json\) is guarded/);
        assert.equal((await h.gate({ tool: "edit", input: { path: target } }))?.block, true);
        assert.equal((await h.gate({ tool: "read", input: { path: target } }))?.block, undefined);
        assert.equal(
            (await h.gate({ tool: "write", input: { path: path.join(project, "src", "a.ts"), content: "x" } }))?.block,
            undefined,
        );
    });

    test("a link to a package, written through, is refused too", async () => {
        h = await start({ cwd: project, plugins: settings([path.join(root, "elsewhere", "pkg")]) });
        const write = await h.gate({
            tool: "write",
            input: { path: path.join(project, "linked", "x.ts"), content: "x" },
        });
        assert.equal(write?.block, true);
        assert.match(write?.reason ?? "", /elsewhere\/pkg \(a package in settings\.json\) is guarded/);
    });

    test("with no settings file anywhere nothing is added", async () => {
        h = await start({ cwd: root });
        assert.equal(h.api.protectedPaths.list().filter((entry) => entry.shown.includes("(a package")).length, 0);
    });
});

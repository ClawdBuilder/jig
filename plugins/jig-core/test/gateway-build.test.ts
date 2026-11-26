// The built gateway (`npm run build:gateway`, scripts/build-gateway.mjs): the committed files are what the sources build to, the same bytes every time; they import only
// Node's own modules and name no machine; the tool list is what the built gateway answers; and a copy of the files with nothing installed beside it runs. The copy is the
// route of the Claude Code plugin: Claude Code unpacks the package from npm and installs none of its dependencies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, test } from "node:test";
import { build } from "esbuild";
import { assertQuietError, GatewayProcess, notJsonRpc, resultOf } from "./support/gateway-child.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DIST = path.join(ROOT, "plugins/jig-core/dist");
const SCRIPT = path.join(ROOT, "scripts/build-gateway.mjs");
const VERSION = (JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;
/** What the build writes, written here as literals: a file that is added or goes is a change to review. */
const FILES = ["connectors/jig-git.mjs", "jig-gateway.mjs", "theme.css", "tools.json"];
const JAVASCRIPT = ["jig-gateway.mjs", "connectors/jig-git.mjs"];

const folders: string[] = [];
afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const made = (prefix: string): string => {
    const folder = mkdtempSync(path.join(tmpdir(), prefix));
    folders.push(folder);
    return folder;
};

/** The build script, run from a folder that is not the repository, as `npm run` would not: it finds the repository from its own place. */
function runBuild(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const folder = mkdtempSync(path.join(tmpdir(), "jig-build-cwd-"));
    try {
        return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: folder, encoding: "utf8", timeout: 120_000 });
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
}

/** Every file below a folder, as paths with forward slashes, sorted. */
function filesUnder(folder: string): string[] {
    return readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
        .sort();
}

const read = (folder: string, file: string): Buffer => readFileSync(path.join(folder, file));

/** Two fresh builds, made once for the tests that compare or read them. */
let fresh: { first: string; second: string; root: string } | undefined;
function freshBuilds(): { first: string; second: string } {
    if (fresh === undefined) {
        const root = mkdtempSync(path.join(tmpdir(), "jig-built-"));
        const [first, second] = [path.join(root, "one"), path.join(root, "two")] as const;
        for (const out of [first, second]) {
            const result = runBuild(["--out", out]);
            assert.equal(result.status, 0, result.stderr);
        }
        fresh = { first, second, root };
    }
    return fresh;
}
after(() => {
    if (fresh !== undefined) rmSync(fresh.root, { recursive: true, force: true });
});

describe("the committed files", () => {
    test("are exactly the files the build makes, and --check says they are current", () => {
        assert.deepEqual(filesUnder(DIST), FILES);
        const result = runBuild(["--check"]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /^plugins\/jig-core\/dist is current: 4 files, identical to a fresh build$/m);
    });

    test("are what two fresh builds write, byte for byte", () => {
        const { first, second } = freshBuilds();
        assert.deepEqual(filesUnder(first), FILES);
        assert.deepEqual(filesUnder(second), FILES);
        for (const file of FILES) {
            assert.ok(read(first, file).equals(read(second, file)), `${file}: two builds differ`);
            assert.ok(
                read(first, file).equals(read(DIST, file)),
                `${file}: the committed file is not what the build writes`,
            );
        }
    });

    test("--check fails on a copy with one byte changed, names that file and the command to run, and names no other", () => {
        const copy = path.join(made("jig-built-copy-"), "dist");
        cpSync(DIST, copy, { recursive: true });
        const bytes = read(copy, "jig-gateway.mjs");
        bytes[1000] = (bytes[1000] ?? 0) ^ 1;
        writeFileSync(path.join(copy, "jig-gateway.mjs"), bytes);
        const result = runBuild(["--check", "--out", copy]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /jig-gateway\.mjs: differs from the build/);
        assert.match(result.stderr, /run `node scripts\/build-gateway\.mjs`/);
        for (const other of ["tools.json", "theme.css", "jig-git.mjs"])
            assert.doesNotMatch(result.stderr, new RegExp(other));
    });

    test("--check names a file that is missing and a file the build does not make", () => {
        const copy = path.join(made("jig-built-copy-"), "dist");
        cpSync(DIST, copy, { recursive: true });
        rmSync(path.join(copy, "tools.json"));
        writeFileSync(path.join(copy, "old.mjs"), "export {};\n");
        const result = runBuild(["--check", "--out", copy]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /tools\.json: is made by the build, but is not there/);
        assert.match(result.stderr, /old\.mjs: is there, but the build does not make it/);
    });

    test("--out puts the files straight into the folder it names", () => {
        const { first } = freshBuilds();
        assert.deepEqual(filesUnder(first), FILES);
    });

    test("an argument the script does not know stops it before it builds, with exit code 2", () => {
        const refused = runBuild(["--nonesuch"]);
        assert.equal(refused.status, 2);
        assert.match(refused.stderr, /unknown argument --nonesuch/);
    });
});

/** The imports a file has, read by esbuild's parser and not by a pattern: a string that holds `require("x")`, as a code generator's templates do, is not one. */
async function importsOf(file: string): Promise<Array<{ kind: string; path: string }>> {
    const result = await build({
        absWorkingDir: ROOT,
        entryPoints: [file],
        outfile: "unused.mjs",
        write: false,
        metafile: true,
        bundle: true,
        format: "esm",
        platform: "node",
        external: ["*"],
        logLevel: "silent",
    });
    return Object.values(result.metafile.inputs).flatMap((input) => input.imports);
}

describe("the built JavaScript", () => {
    test("import only modules of Node, by import and by require, so that they run with nothing installed", async () => {
        for (const folder of [DIST, freshBuilds().first]) {
            for (const file of JAVASCRIPT) {
                const imports = await importsOf(path.join(folder, file));
                assert.ok(imports.length > 0, `${file}: no imports were read`);
                const others = imports.filter((one) => !one.path.startsWith("node:"));
                assert.deepEqual(others, [], `${file} imports something that is not a module of Node`);
            }
        }
    });

    test("name no machine: no home folder, no temporary folder, no folder of this checkout", () => {
        const { first } = freshBuilds();
        // A fresh build would hold the paths of this machine, if it held any; the committed files, which another machine made, are read for the common forms.
        for (const [folder, forbidden] of [
            [first, [ROOT, homedir(), tmpdir(), "jig-gateway-build-"]],
            [DIST, ["/home/", "/Users/", "/tmp/", "jig-gateway-build-"]],
        ] as const) {
            for (const file of FILES) {
                const text = read(folder, file).toString("utf8");
                for (const word of forbidden) {
                    assert.equal(text.includes(word), false, `${file} holds ${word}`);
                }
            }
        }
    });

    test("the reader of imports finds a bare import, a dynamic one and a require of a package, and passes a string that only looks like one", async () => {
        const folder = made("jig-imports-");
        const file = path.join(folder, "sample.mjs");
        writeFileSync(
            file,
            [
                'import fs from "node:fs";',
                'import typebox from "typebox";',
                'const later = await import("@earendil-works/pi-coding-agent");',
                'const loaded = require("zod");',
                "const template = 'require(\"ajv/dist/runtime/equal\").default';",
                "export { fs, typebox, later, loaded, template };",
                "",
            ].join("\n"),
        );
        const imports = await importsOf(file);
        assert.deepEqual(imports.map((one) => `${one.kind} ${one.path}`).sort(), [
            "dynamic-import @earendil-works/pi-coding-agent",
            "import-statement node:fs",
            "import-statement typebox",
            "require-call zod",
        ]);
    });

    test("a Pi package is not in them, even as a word of an import", () => {
        for (const file of JAVASCRIPT) {
            assert.doesNotMatch(read(DIST, file).toString("utf8"), /from "@earendil-works\//, file);
        }
    });

    test("theme.css is a copy of the source file, so that kit/theme.ts finds it beside the bundle", () => {
        assert.ok(read(DIST, "theme.css").equals(readFileSync(path.join(ROOT, "plugins/jig-core/src/kit/theme.css"))));
    });
});

describe("tools.json", () => {
    test("is what the built gateway answers to tools/list, tool for tool, with the connector of each, sorted by name", async () => {
        const gateway = new GatewayProcess({
            file: path.join(DIST, "jig-gateway.mjs"),
            cwd: made("jig-built-cwd-"),
            env: { ...process.env, JIG_HOME: "" },
        });
        try {
            const answered = (
                resultOf(await gateway.request("tools/list")).tools as Array<Record<string, unknown>>
            ).map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema }));
            const text = readFileSync(path.join(DIST, "tools.json"), "utf8");
            const committed = JSON.parse(text) as Array<Record<string, unknown>>;
            assert.deepEqual(
                committed.map(({ connector: _connector, ...tool }) => tool),
                answered,
            );
            assert.deepEqual(
                committed.map((tool) => [tool.name, tool.connector]),
                [
                    ["jig", "jig-core"],
                    ["pr", "jig-git"],
                    ["release", "jig-git"],
                ],
            );
            assert.equal(
                text,
                `${JSON.stringify(committed, null, 4)}\n`,
                "written the way the build writes it, with a newline at the end",
            );
            assert.deepEqual(await gateway.end(), { code: 0, signal: null });
        } finally {
            gateway.kill();
        }
    });
});

/** A folder with the layout of the package, `plugins/jig-core/dist` below a package.json, and no node_modules above it: what Claude Code unpacks from npm. */
function unpacked(): string {
    const folder = made("jig-unpacked-");
    cpSync(DIST, path.join(folder, "plugins/jig-core/dist"), { recursive: true });
    cpSync(path.join(ROOT, "package.json"), path.join(folder, "package.json"));
    mkdirSync(path.join(folder, "bin"));
    cpSync(path.join(ROOT, "bin/jig-gateway.mjs"), path.join(folder, "bin/jig-gateway.mjs"));
    assert.equal(existsSync(path.join(folder, "node_modules")), false);
    return folder;
}

describe("a copy of the built files with nothing installed beside them", () => {
    test("prints the version of the package, from its package.json three folders up", () => {
        const folder = unpacked();
        const run = spawnSync(
            process.execPath,
            [path.join(folder, "plugins/jig-core/dist/jig-gateway.mjs"), "--version"],
            {
                cwd: folder,
                encoding: "utf8",
                timeout: 20_000,
            },
        );
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout, `${VERSION}\n`);
    });

    test("answers tools/list with the three tools, and leaves when input ends", async () => {
        const folder = unpacked();
        const gateway = new GatewayProcess({
            file: path.join(folder, "plugins/jig-core/dist/jig-gateway.mjs"),
            cwd: folder,
            env: { ...process.env, JIG_HOME: "" },
        });
        try {
            const tools = resultOf(await gateway.request("tools/list")).tools as Array<{ name: string }>;
            assert.deepEqual(
                tools.map((tool) => tool.name),
                ["jig", "pr", "release"],
            );
            assert.deepEqual(await gateway.end(), { code: 0, signal: null });
            assert.deepEqual(notJsonRpc(gateway.lines), []);
            assertQuietError(gateway);
        } finally {
            gateway.kill();
        }
    });
});

describe("the start file bin/jig-gateway.mjs", () => {
    test("starts the built gateway through a link, as npm links a command into a bin folder", () => {
        const folder = unpacked();
        const link = path.join(made("jig-link-"), "jig-gateway");
        symlinkSync(path.join(folder, "bin/jig-gateway.mjs"), link);
        const run = spawnSync(process.execPath, [link, "--version"], {
            cwd: folder,
            encoding: "utf8",
            timeout: 20_000,
        });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout, `${VERSION}\n`);
    });

    test("says in one line on standard error that the built gateway is missing, and leaves with a code that is not 0", () => {
        const folder = made("jig-nobuild-");
        mkdirSync(path.join(folder, "bin"));
        cpSync(path.join(ROOT, "bin/jig-gateway.mjs"), path.join(folder, "bin/jig-gateway.mjs"));
        const run = spawnSync(process.execPath, [path.join(folder, "bin/jig-gateway.mjs"), "--version"], {
            cwd: folder,
            encoding: "utf8",
            timeout: 20_000,
        });
        assert.notEqual(run.status, 0);
        assert.equal(run.stdout, "");
        assert.match(run.stderr, /^jig-gateway: the built gateway is missing\. .*\n$/);
        assert.equal(run.stderr.trim().split("\n").length, 1);
    });
});

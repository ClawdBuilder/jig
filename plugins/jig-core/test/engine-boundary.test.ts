// The engine boundary. Every `.ts` file under `plugins/jig-core/src` that is not on Pi's side (test/support/engine-files.ts) is an
// engine file, and an engine file must not reach a package whose name starts with `@earendil-works/`: not by importing one, and not
// by importing a file that does, at any depth. Only imports that run count: `import type`, `export type` and a type expression such
// as `import("pkg").T` are erased and load nothing. The inline form `import { type X } from "pkg"` does count, because Node keeps
// the import when it strips the type. An engine file that imports a Pi-side file at run time reaches Pi too.
//
// A tool that runs outside Pi has to load the engine without Pi's packages installed, so a path to one is a failure of that
// install, not of style. A few terminal-command files still reach Pi because they build the state with Pi's wrapper (`state.ts`);
// they are listed, and the test fails when a listed file stops reaching Pi, so the list can only shrink.
//
// One more rule is about a library and not about Pi: no file outside `src/gateway/` imports an MCP library (design 5.5), so the engine stays a library that
// any front door can use, and the SDK's types do not leak into it. The gateway's own files are engine files like the rest.
import assert from "node:assert/strict";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { importsOf } from "../../../scripts/imports.mjs";
import { PI_SIDE_FILES, REACHES_PI_FOR_NOW } from "./support/engine-files.ts";

const SRC = path.resolve(import.meta.dirname, "../src");
const PI_PACKAGES = "@earendil-works/";

interface Lists {
    piSide: readonly string[];
    forNow: readonly string[];
}

/** The imports of one file that run: the files it loads, and the Pi packages it names, each with its line. */
interface Node {
    files: { target: string; line: number }[];
    packages: { name: string; line: number }[];
}

/** How a file reaches Pi: the chain as text, and the package it ends at (none when it ends at a Pi-side file). */
interface Reach {
    chain: string;
    pkg: string | undefined;
}

/** Every `.ts` file under a folder, relative to it with `/` separators. */
function sourceFiles(root: string, folder = root): string[] {
    return readdirSync(folder).flatMap((name) => {
        const full = path.join(folder, name);
        if (name === "node_modules") return [];
        if (statSync(full).isDirectory()) return sourceFiles(root, full);
        return name.endsWith(".ts") ? [path.relative(root, full).split(path.sep).join("/")] : [];
    });
}

/** Reads the imports of a file that run, once. A relative import the check cannot follow is an error, not a skipped file. */
function reader(root: string): (file: string) => Node {
    const nodes = new Map<string, Node>();
    return (file) => {
        const known = nodes.get(file);
        if (known !== undefined) return known;
        const node: Node = { files: [], packages: [] };
        for (const { specifier, line, typeOnly } of importsOf(readFileSync(path.join(root, file), "utf8"))) {
            if (typeOnly) continue;
            if (specifier.startsWith(".")) {
                const target = path
                    .relative(root, path.resolve(path.dirname(path.join(root, file)), specifier))
                    .split(path.sep)
                    .join("/");
                if (!target.endsWith(".ts") || !existsSync(path.join(root, target))) {
                    throw new Error(
                        `${file}:${line} imports "${specifier}", which is not a .ts file that exists, so the engine check cannot follow it`,
                    );
                }
                node.files.push({ target, line });
            } else if (specifier.startsWith(PI_PACKAGES)) {
                node.packages.push({ name: specifier, line });
            }
        }
        nodes.set(file, node);
        return node;
    };
}

/**
 * The shortest chain of imports that run from `start` to a Pi package. When there is none, the shortest to a Pi-side file. A chain
 * that passes a Pi-side file goes on to the package when it can, so that the message names the package. In a chain, `file:N` is
 * the import on line N of that file that leads to the next.
 */
function reachOf(read: (file: string) => Node, start: string, piSide: ReadonlySet<string>): Reach | undefined {
    const came = new Map<string, { from: string; line: number } | undefined>([[start, undefined]]);
    const queue = [start];
    let side: string | undefined;
    const render = (end: string, endLine?: number): string => {
        const files: string[] = [];
        for (let at: string | undefined = end; at !== undefined; at = came.get(at)?.from) files.unshift(at);
        const steps = files.map((file, i) => {
            const next = files[i + 1];
            const line = next === undefined ? endLine : came.get(next)?.line;
            return line === undefined ? file : `${file}:${line}`;
        });
        return steps.join(" -> ");
    };
    for (let i = 0; i < queue.length; i++) {
        const file = queue[i] as string;
        const node = read(file);
        const direct = node.packages[0];
        if (direct !== undefined) return { chain: `${render(file, direct.line)} -> ${direct.name}`, pkg: direct.name };
        if (file !== start && side === undefined && piSide.has(file)) side = file;
        for (const next of node.files) {
            if (came.has(next.target)) continue;
            came.set(next.target, { from: file, line: next.line });
            queue.push(next.target);
        }
    }
    if (side === undefined) return undefined;
    return { chain: `${render(side)} (a Pi-side file)`, pkg: undefined };
}

/** Every engine file of a tree (a `.ts` file on neither list) that reaches Pi, with how. */
function violations(root: string, lists: Lists): Map<string, Reach> {
    const piSide = new Set(lists.piSide);
    const exempt = new Set([...lists.piSide, ...lists.forNow]);
    const read = reader(root);
    const found = new Map<string, Reach>();
    for (const file of sourceFiles(root)) {
        if (exempt.has(file)) continue;
        const reach = reachOf(read, file, piSide);
        if (reach !== undefined) found.set(file, reach);
    }
    return found;
}

/** The failure message for one engine file: the file, the chain of imports and the package. */
function said(file: string, reach: Reach): string {
    const where = reach.pkg === undefined ? "a Pi-side file" : `the package ${reach.pkg}`;
    return `${file} is an engine file and reaches ${where} through imports that run: ${reach.chain}. An engine file must not reach a package that starts with "${PI_PACKAGES}", directly or through a file it imports; "import type" does not count. Cut the import, or move the code to Pi's side (test/support/engine-files.ts).`;
}

const LISTS: Lists = { piSide: PI_SIDE_FILES, forNow: REACHES_PI_FOR_NOW };

describe("the engine files of jig-core", () => {
    test("every listed file exists, and no file is on two lists", () => {
        const files = new Set(sourceFiles(SRC));
        const all = [...PI_SIDE_FILES, ...REACHES_PI_FOR_NOW];
        assert.deepEqual(
            all.filter((file) => !files.has(file)),
            [],
            "a file on a list of test/support/engine-files.ts is not in plugins/jig-core/src",
        );
        assert.deepEqual(
            all.filter((file, index) => all.indexOf(file) !== index),
            [],
            "a file is on two lists, or twice on one",
        );
    });

    test("an engine file reaches no Pi package through imports that run", () => {
        const found = violations(SRC, LISTS);
        assert.deepEqual(
            [...found].map(([file, reach]) => said(file, reach)),
            [],
        );
    });

    test("a file that is exempt for now still reaches Pi, or it is an engine file and the list says so", () => {
        const read = reader(SRC);
        const piSide = new Set(PI_SIDE_FILES);
        const clean = REACHES_PI_FOR_NOW.filter((file) => reachOf(read, file, piSide) === undefined);
        assert.deepEqual(
            clean,
            [],
            "these files no longer reach Pi: remove them from REACHES_PI_FOR_NOW in test/support/engine-files.ts; they are engine files now",
        );
    });

    test("the files that were cut loose from Pi are engine files that reach none", () => {
        const read = reader(SRC);
        const piSide = new Set(PI_SIDE_FILES);
        const listed = new Set([...PI_SIDE_FILES, ...REACHES_PI_FOR_NOW]);
        const cut = [
            "ask.ts",
            "kit/tools-section.ts",
            "preview-html.ts",
            "preview-server.ts",
            "api.ts",
            "engine.ts",
            "engine-state.ts",
            "engine-judge.ts",
            "engine-results.ts",
            "engine-session.ts",
        ];
        for (const file of cut) {
            assert.ok(!listed.has(file), `${file} is on a list of test/support/engine-files.ts`);
            const reach = reachOf(read, file, piSide);
            assert.equal(reach, undefined, reach === undefined ? "" : said(file, reach));
        }
    });
});

const MCP_PACKAGES = "@modelcontextprotocol/";

/** Every import of an MCP library in a tree outside the `gateway` folder: the file, the line and the package, as text. Any import counts, a type too. */
function mcpImportsOutsideGateway(root: string): string[] {
    const found: string[] = [];
    for (const file of sourceFiles(root)) {
        if (file.startsWith("gateway/")) continue;
        for (const { specifier, line } of importsOf(readFileSync(path.join(root, file), "utf8"))) {
            if (specifier.startsWith(MCP_PACKAGES)) found.push(`${file}:${line} imports ${specifier}`);
        }
    }
    return found;
}

describe("the MCP library is the gateway's alone", () => {
    test("no file outside gateway/ imports an MCP library", () => {
        assert.deepEqual(mcpImportsOutsideGateway(SRC), []);
    });

    test("the gateway's files are engine files that reach no Pi package, and none is exempt on a list", () => {
        const read = reader(SRC);
        const piSide = new Set(PI_SIDE_FILES);
        const listed = new Set([...PI_SIDE_FILES, ...REACHES_PI_FOR_NOW]);
        const gateway = sourceFiles(SRC).filter((file) => file.startsWith("gateway/"));
        assert.equal(gateway.length > 0, true, "the gateway has files");
        for (const file of gateway) {
            assert.ok(!listed.has(file), `${file} is on a list of test/support/engine-files.ts`);
            const reach = reachOf(read, file, piSide);
            assert.equal(reach, undefined, reach === undefined ? "" : said(file, reach));
        }
    });

    test("the check finds an import of any kind, in any folder but the gateway's", () => {
        const root = mkdtempSync(path.join(tmpdir(), "jig-engine-"));
        const write = (file: string, text: string) => {
            mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            writeFileSync(path.join(root, file), text);
        };
        try {
            write("gateway/server.ts", 'import { McpServer } from "@modelcontextprotocol/server";\n');
            write("engine.ts", 'import { McpServer } from "@modelcontextprotocol/server";\n');
            write("kit/types.ts", 'import type { Tool } from "@modelcontextprotocol/core";\n');
            write("later.ts", 'const stdio = await import("@modelcontextprotocol/server/stdio");\n');
            write("fine.ts", 'import { hono } from "hono";\nimport "@modelcontextprotocolx/other";\n');
            assert.deepEqual(mcpImportsOutsideGateway(root).sort(), [
                "engine.ts:1 imports @modelcontextprotocol/server",
                "kit/types.ts:1 imports @modelcontextprotocol/core",
                "later.ts:1 imports @modelcontextprotocol/server/stdio",
            ]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("the check finds a path to Pi, and says which file, which chain and which package", () => {
    function tree(files: Record<string, string>): string {
        const root = mkdtempSync(path.join(tmpdir(), "jig-engine-"));
        for (const [file, text] of Object.entries(files)) {
            mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            writeFileSync(path.join(root, file), text);
        }
        return root;
    }

    test("it follows imports that run at any depth, and ignores types", () => {
        const root = tree({
            "direct.ts": 'import { Text } from "@earendil-works/pi-tui";\n',
            "middle.ts": 'export * from "./direct.ts";\n',
            "indirect.ts": '\nimport { Text } from "./middle.ts";\n',
            "late.ts": 'const later = await import("./direct.ts");\n',
            "inline.ts": 'import { type Tool } from "@earendil-works/pi-ai";\n',
            "sub/deep.ts": 'import {\n    Text,\n} from "../direct.ts";\n',
            "via-side.ts": 'import { screen } from "./side.ts";\n',
            "side.ts": "export const screen = 1;\n",
            "side-with-pi.ts": 'import { Text } from "@earendil-works/pi-tui";\n',
            "for-now.ts": 'import { Text } from "@earendil-works/pi-coding-agent";\n',
            "types.ts": [
                'import type { A } from "@earendil-works/pi-coding-agent";',
                'export type { B } from "@earendil-works/pi-ai";',
                'export type * from "./direct.ts";',
                'export const c: import("@earendil-works/pi-tui").C = 1 as never;',
                'export type M = typeof import("./direct.ts");',
                'import path from "node:path";',
                'import "@earendil-worksx/other";',
                "",
            ].join("\n"),
            "cycle-a.ts": 'import "./cycle-b.ts";\n',
            "cycle-b.ts": 'import "./cycle-a.ts";\n',
        });
        try {
            const found = violations(root, {
                piSide: ["side.ts", "side-with-pi.ts"],
                forNow: ["for-now.ts"],
            });
            assert.deepEqual([...found.keys()].sort(), [
                "direct.ts",
                "indirect.ts",
                "inline.ts",
                "late.ts",
                "middle.ts",
                "sub/deep.ts",
                "via-side.ts",
            ]);
            assert.equal(found.get("direct.ts")?.chain, "direct.ts:1 -> @earendil-works/pi-tui");
            assert.equal(
                found.get("indirect.ts")?.chain,
                "indirect.ts:2 -> middle.ts:1 -> direct.ts:1 -> @earendil-works/pi-tui",
            );
            assert.equal(found.get("late.ts")?.chain, "late.ts:1 -> direct.ts:1 -> @earendil-works/pi-tui");
            assert.equal(found.get("inline.ts")?.pkg, "@earendil-works/pi-ai");
            // A statement over several lines is found at its string, so the line is the one of `from "../direct.ts"`.
            assert.equal(found.get("sub/deep.ts")?.chain, "sub/deep.ts:3 -> direct.ts:1 -> @earendil-works/pi-tui");
            assert.deepEqual(found.get("via-side.ts"), {
                chain: "via-side.ts:1 -> side.ts (a Pi-side file)",
                pkg: undefined,
            });
            const message = said("indirect.ts", found.get("indirect.ts") as Reach);
            assert.match(message, /^indirect\.ts is an engine file and reaches the package @earendil-works\/pi-tui /);
            assert.match(message, /indirect\.ts:2 -> middle\.ts:1 -> direct\.ts:1 -> @earendil-works\/pi-tui/);
            assert.match(said("via-side.ts", found.get("via-side.ts") as Reach), /reaches a Pi-side file/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("a Pi-side file that goes on to a package makes the chain name the package", () => {
        const root = tree({
            "engine.ts": 'import { screen } from "./side.ts";\n',
            "side.ts": 'import { draw } from "./draw.ts";\n',
            "draw.ts": 'import { Text } from "@earendil-works/pi-tui";\n',
        });
        try {
            const found = violations(root, { piSide: ["side.ts"], forNow: [] });
            assert.equal(
                found.get("engine.ts")?.chain,
                "engine.ts:1 -> side.ts:1 -> draw.ts:1 -> @earendil-works/pi-tui",
            );
            assert.deepEqual([...found.keys()].sort(), ["draw.ts", "engine.ts"]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("a relative import it cannot follow is an error, not a file it skips", () => {
        const root = tree({ "broken.ts": 'import "./missing.ts";\n', "data.ts": 'import data from "./data.json";\n' });
        try {
            assert.throws(
                () => violations(root, { piSide: [], forNow: [] }),
                /(broken|data)\.ts:1 imports "\.\/(missing\.ts|data\.json)"/,
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe("importsOf says whether an import is type-only", () => {
    const text = [
        'import type { A } from "a";',
        'import b from "b";',
        'import { type C } from "c";',
        'export type { D } from "d";',
        'export type * from "e";',
        'export { f } from "f";',
        'import type from "g";',
        "import {",
        "    h,",
        '} from "h";',
        'import "i";',
        'const j = await import("j");',
        'const k = require("k");',
        'import("l").then((m) => m);',
        'const n: import("n").T = 1;',
        'type O = typeof import("o");',
        'type P = Promise<import("p").Q<string>>;',
        "",
    ].join("\n");

    test("only `import type`, `export type` and a type expression are type-only", () => {
        const flags = Object.fromEntries(importsOf(text).map(({ specifier, typeOnly }) => [specifier, typeOnly]));
        assert.deepEqual(flags, {
            a: true,
            b: false,
            c: false,
            d: true,
            e: true,
            f: false,
            g: false,
            h: false,
            i: false,
            j: false,
            k: false,
            l: false,
            n: true,
            o: true,
            p: true,
        });
    });

    test("the lines are the same as before, and a statement over several lines is found at its string", () => {
        const lines = Object.fromEntries(importsOf(text).map(({ specifier, line }) => [specifier, line]));
        assert.equal(lines.a, 1);
        assert.equal(lines.h, 10);
        assert.equal(lines.p, 17);
    });

    test("by default a type expression is listed, as it always was; `typeExpressions: false` leaves it out", () => {
        assert.deepEqual(
            importsOf(text).map(({ specifier }) => specifier),
            ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "n", "o", "p"],
        );
        assert.deepEqual(
            importsOf(text, { typeExpressions: false }).map(({ specifier }) => specifier),
            ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"],
        );
        assert.deepEqual(importsOf(text, {}), importsOf(text));
    });
});

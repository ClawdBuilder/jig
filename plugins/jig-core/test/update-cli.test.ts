// The words `jig update` takes, the Pi commands it builds from them, and the checks that stop it before anything moves.
// Nothing here starts Pi or asks npm: the forms are pure, and the end-to-end runs are in cli-home.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { installedRequirement, looksLikeSource, parse, piCommands, upToDate, update } from "../src/cli/update.ts";

const NAME = "@clawdbuilder/jig";
let root: string;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-update-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function parsed(args: string[]) {
    const result = parse(args);
    assert.ok(!("problem" in result), "problem" in result ? result.problem : "");
    return result;
}

describe("what jig update takes", () => {
    test("no target means all of Jig and the unpinned packages", () => {
        assert.deepEqual(parsed([]).form, { kind: "all" });
        assert.deepEqual(parsed(["--all"]).form, { kind: "all" });
    });

    test("--self and self are Jig only, which is not Pi's meaning", () => {
        assert.deepEqual(parsed(["--self"]).form, { kind: "self" });
        assert.deepEqual(parsed(["self"]).form, { kind: "self" });
    });

    test("--extensions and --models are the other packages and Pi's catalogs", () => {
        assert.deepEqual(parsed(["--extensions"]).form, { kind: "extensions" });
        assert.deepEqual(parsed(["--models"]).form, { kind: "models" });
    });

    test("one package, by positional or --extension", () => {
        assert.deepEqual(parsed(["npm:@scope/tools"]).form, { kind: "source", source: "npm:@scope/tools" });
        assert.deepEqual(parsed(["--extension", NAME]).form, { kind: "source", source: NAME });
    });

    test("the flags Pi's update takes are understood: approve, no-approve and --to", () => {
        const approve = parsed(["--extensions", "-a", "--to", "0.6.0", "--check", "--json", "--yes"]);
        assert.deepEqual(approve.approve, ["--approve"]);
        assert.equal(approve.requested, "0.6.0");
        assert.equal(approve.check, true);
        assert.equal(approve.json, true);
        assert.equal(approve.yes, true);
        assert.deepEqual(parsed(["--no-approve"]).approve, ["--no-approve"]);
    });

    test("a missing value for a flag is a usage error", () => {
        for (const args of [["--to"], ["--extension"], ["--extension", "--models"]]) {
            const result = parse(args);
            assert.ok("problem" in result, args.join(" "));
            assert.match(result.problem, /needs a (version|package source)/);
        }
    });

    test("two targets are refused instead of guessing", () => {
        const result = parse(["--self", "--models"]);
        assert.ok("problem" in result);
        assert.match(result.problem, /takes one target at a time/);
    });

    test("pi and --force are refused, because in Pi they reinstall the Pi binary", () => {
        for (const args of [["pi"], ["--force"], ["--all", "--force"]]) {
            const result = parse(args);
            assert.ok("problem" in result, args.join(" "));
            assert.equal(
                result.problem,
                "Jig never updates Pi itself (your pi and others share it). Run: pi update --self",
            );
        }
    });

    test("a word that is not a source is a stray word, with the way to ask Pi", () => {
        const result = parse(["the", "readme"]);
        assert.ok("problem" in result);
        assert.equal(result.problem, 'jig update takes no words like "the". To ask Pi, run: jig "update the readme"');
    });

    test("an unknown option says so and points at the help", () => {
        const result = parse(["--nope"]);
        assert.ok("problem" in result);
        assert.match(result.problem, /^jig update: unknown option --nope\./);
        assert.match(result.problem, /Run jig update --help/);
    });

    test("a source is an npm or git spec, a URL, a host/path, or a path", () => {
        for (const word of [
            "npm:@scope/tools",
            "git:github.com/acme/tools",
            "git:github.com/acme/tools@v1",
            "https://example.com/tools.tgz",
            "github.com/acme/tools",
            "./tools",
            "/opt/tools",
            "~/tools",
            "jig-0.5.4.tgz",
        ]) {
            assert.equal(looksLikeSource(word), true, word);
        }
        for (const word of ["the", "readme", "doctor", "install", "pip"]) {
            assert.equal(looksLikeSource(word), false, word);
        }
    });
});

describe("the Pi commands a form builds", () => {
    test("Jig's own entry moves with pi install, because setup pins it", () => {
        assert.deepEqual(piCommands({ kind: "self" }, NAME, [], "0.6.0"), [["install", `npm:${NAME}@0.6.0`]]);
        assert.deepEqual(piCommands({ kind: "all" }, NAME, [], "0.6.0"), [
            ["install", `npm:${NAME}@0.6.0`],
            ["update", "--extensions"],
        ]);
    });

    test("the other forms are Pi's own update", () => {
        assert.deepEqual(piCommands({ kind: "extensions" }, NAME, [], undefined), [["update", "--extensions"]]);
        assert.deepEqual(piCommands({ kind: "models" }, NAME, [], undefined), [["update", "--models"]]);
        assert.deepEqual(piCommands({ kind: "source", source: "npm:x" }, NAME, [], undefined), [
            ["update", "--extension", "npm:x"],
        ]);
    });

    test("an up-to-date Jig runs nothing of its own, and an approve flag goes last", () => {
        assert.deepEqual(piCommands({ kind: "self" }, NAME, [], undefined), []);
        assert.deepEqual(piCommands({ kind: "all" }, NAME, [], undefined), [["update", "--extensions"]]);
        assert.deepEqual(piCommands({ kind: "models" }, NAME, ["--approve"], undefined), [
            ["update", "--models", "--approve"],
        ]);
    });
});

describe("the checks", () => {
    test("a running Jig newer than the registry is up to date; an explicit target is still planned", () => {
        assert.equal(upToDate("0.5.4", "0.5.3", undefined), true);
        assert.equal(upToDate("0.5.4", "0.5.4", undefined), true);
        assert.equal(upToDate("0.5.4", "0.6.0", undefined), false);
        assert.equal(upToDate("0.5.4", "0.5.3", "0.5.3"), false);
    });

    test("the Pi requirement of the Jig now in the home is read from its manifest", () => {
        const folder = path.join(root, "npm", "node_modules", "@clawdbuilder", "jig");
        mkdirSync(path.join(folder, "bin"), { recursive: true });
        writeFileSync(path.join(folder, "bin", "jig.mjs"), "#!/usr/bin/env node\n");
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({
                name: NAME,
                version: "0.6.0",
                jig: { agents: { pi: { minimum: "1.6.0", tested: "1.7.0" } } },
            }),
        );
        assert.deepEqual(installedRequirement(root, NAME), { minimum: "1.6.0", tested: "1.7.0" });
        assert.equal(installedRequirement(path.join(root, "elsewhere"), NAME), undefined);
    });
});

describe("the gate before a change", () => {
    /** Runs the command with stderr captured, and gives the text and the code back. */
    async function refused(args: string[]): Promise<{ code: number; text: string }> {
        const saved = process.stderr.write;
        const savedCi = process.env.CI;
        delete process.env.CI;
        let text = "";
        process.stderr.write = ((chunk: string | Uint8Array) => {
            text += String(chunk);
            return true;
        }) as typeof process.stderr.write;
        try {
            const code = await update(args, { home: path.join(root, "no-home") });
            return { code, text };
        } finally {
            process.stderr.write = saved;
            if (savedCi === undefined) delete process.env.CI;
            else process.env.CI = savedCi;
        }
    }

    test("without a terminal it refuses in one line, before the registry or any change", async () => {
        const { code, text } = await refused([]);
        assert.equal(code, 2);
        assert.match(text, /no terminal to confirm on/);
        assert.match(text, /jig update --check/);
    });

    test("an unknown option is a usage error, not a change", async () => {
        const { code, text } = await refused(["--nope"]);
        assert.equal(code, 2);
        assert.match(text, /jig update: unknown option --nope/);
    });

    test("pi itself is refused", async () => {
        const { code, text } = await refused(["pi"]);
        assert.equal(code, 2);
        assert.match(text, /Run: pi update --self/);
    });

    test("a check with no Jig in the home refuses before it reads the registry", async () => {
        const { code, text } = await refused(["--check"]);
        assert.equal(code, 1);
        assert.match(text, /Jig is not installed in .*no-home/);
    });
});

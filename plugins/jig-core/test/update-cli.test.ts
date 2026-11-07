// The facts `jig update` reads before changing anything: the installed copies and company ranges, and the exact Pi command
// for the method Pi was installed by. Registry and command runs are faked in update-plan.test.ts and update-run.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { discover, piSelfUpdateCommands, update } from "../src/cli/update.ts";
import { executeUpdate } from "../src/update-run.ts";
import type { InstallCommand, UpdateIo } from "../src/update-run.ts";
import { planUpdate } from "../src/update-plan.ts";
import type { UpdatePlan } from "../src/update-plan.ts";
import type { PiConfigModule } from "../src/cli/update.ts";

let home: string;
let agent: string;
let work: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-update-"));
    agent = path.join(home, "agent");
    work = path.join(home, "work");
    mkdirSync(agent, { recursive: true });
    mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function packageAt(folder: string, value: unknown): void {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "package.json"), JSON.stringify(value));
}

describe("discover", () => {
    test("finds Jig's Pi copy by source even when its folder is there, and every company range", () => {
        const jig = path.join(agent, "npm", "node_modules", "@clawdbuilder", "jig");
        const company = path.join(agent, "npm", "node_modules", "acme-jig");
        packageAt(jig, { name: "@clawdbuilder/jig", version: "0.4.1" });
        packageAt(company, { name: "acme-jig", jig: { range: ">=0.4.1 <0.5.0" } });
        writeFileSync(
            path.join(agent, "settings.json"),
            JSON.stringify({ packages: ["npm:@clawdbuilder/jig", "npm:acme-jig"] }),
        );
        const found = discover(agent, work, "@clawdbuilder/jig");
        assert.deepEqual(found.piCopy, {
            version: "0.4.1",
            source: "npm:@clawdbuilder/jig",
            scope: "user",
            folder: jig,
        });
        assert.deepEqual(found.company, [{ package: "acme-jig", range: ">=0.4.1 <0.5.0" }]);
    });

    test("refuses two Jig entries and names a pi remove for each, without choosing", () => {
        const first = path.join(agent, "npm", "node_modules", "@clawdbuilder", "jig");
        const second = path.join(work, ".pi", "local-jig");
        packageAt(first, { name: "@clawdbuilder/jig", version: "0.4.1" });
        packageAt(second, { name: "@clawdbuilder/jig", version: "0.4.2" });
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:@clawdbuilder/jig"] }));
        mkdirSync(path.join(work, ".pi"), { recursive: true });
        writeFileSync(path.join(work, ".pi", "settings.json"), JSON.stringify({ packages: [second] }));
        const found = discover(agent, work, "@clawdbuilder/jig");
        assert.ok(found.problem);
        assert.match(found.problem, /2 Jig entries/);
        assert.match(found.problem, /pi remove npm:@clawdbuilder\/jig/);
        assert.doesNotMatch(found.problem, /pi remove npm:@clawdbuilder\/jig -l/);
        assert.match(found.problem, new RegExp(`pi remove ${second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -l`));
        assert.equal(found.jigEntries.length, 2);
    });

    test("finds a package by its npm name when the folder is missing", () => {
        writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:@clawdbuilder/jig@0.4.1"] }));
        const found = discover(agent, work, "@clawdbuilder/jig");
        assert.equal(found.piCopy?.source, "npm:@clawdbuilder/jig@0.4.1");
        assert.equal(found.piCopy?.version, undefined);
    });
});

describe("the update command's gate", () => {
    test("without a terminal it refuses in one line, before the registry or any change", async () => {
        const saved = process.stderr.write;
        let text = "";
        process.stderr.write = ((chunk: string | Uint8Array) => {
            text += String(chunk);
            return true;
        }) as typeof process.stderr.write;
        try {
            const code = await update([], undefined);
            assert.equal(code, 1);
            assert.match(text, /Update needs a terminal with a screen/);
            assert.match(text, /jig update --check/);
        } finally {
            process.stderr.write = saved;
        }
    });

    test("unknown options are a usage error", async () => {
        const saved = process.stderr.write;
        let text = "";
        process.stderr.write = ((chunk: string | Uint8Array) => {
            text += String(chunk);
            return true;
        }) as typeof process.stderr.write;
        try {
            assert.equal(await update(["--nope"], undefined), 2);
            assert.match(text, /Unknown option --nope/);
        } finally {
            process.stderr.write = saved;
        }
    });
});

describe("two updates in a row", () => {
    test("the exact pin Pi leaves is movable, and the filter survives the source replacement", async () => {
        const name = "@clawdbuilder/jig";
        const jig = path.join(agent, "npm", "node_modules", "@clawdbuilder", "jig");
        packageAt(jig, { name, version: "0.4.1" });
        const settings = path.join(agent, "settings.json");
        const source = (): string => {
            const value = JSON.parse(readFileSync(settings, "utf8")) as { packages: Array<{ source: string }> };
            return value.packages[0]?.source ?? "";
        };
        const manifestVersion = (): string =>
            (JSON.parse(readFileSync(path.join(jig, "package.json"), "utf8")) as { version: string }).version;
        const writeSource = (value: string): void => {
            writeFileSync(
                settings,
                JSON.stringify({ packages: [{ source: value, extensions: ["!plugins/jig-lens/index.ts"] }] }),
            );
        };
        writeSource(`npm:${name}`);

        const target = (version: string) => ({
            version,
            release: { jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.0" } } } },
            newest: version,
            cappedBy: [],
        });
        const planFor = (version: string): UpdatePlan => {
            const copy = discover(agent, work, name).piCopy;
            assert.ok(copy);
            const built = planUpdate({
                name,
                current: manifestVersion(),
                target: target(version),
                piVersion: "1.5.0",
                piCopy: copy,
                globalVersion: version,
            });
            if (!("plan" in built)) throw new Error(built.problem);
            return built.plan;
        };
        let expected = "0.5.0";
        const io: UpdateIo = {
            async run(command, args) {
                assert.equal(command, "pi");
                const spec = args[1] ?? "";
                const version = spec.slice(spec.lastIndexOf("@") + 1);
                writeFileSync(path.join(jig, "package.json"), JSON.stringify({ name, version }));
                // Pi 1.5.0's addSourceToSettings: an object entry is `{ ...existing, source }`, so its filter stays.
                writeSource(spec);
                return { code: 0, stdout: "", stderr: "" };
            },
            notify() {},
            async confirm() {
                return true;
            },
            async piInstall(version): Promise<InstallCommand[]> {
                return [{ command: "pi-self", args: [version], display: `install Pi ${version}` }];
            },
            piCopyInstall(version): InstallCommand {
                return { command: "pi", args: ["install", `npm:${name}@${version}`], display: `install ${version}` };
            },
            piCopyRestore(source): InstallCommand {
                return { command: "pi", args: ["install", source], display: `restore ${source}` };
            },
            globalInstall(version): InstallCommand {
                return { command: "npm", args: ["install", "-g", `@x/y@${version}`], display: `install ${version}` };
            },
            async verify() {
                return { pi: "1.5.0", piCopy: manifestVersion(), global: expected };
            },
            async doctor() {
                return { code: 0, output: "" };
            },
        };

        const first = planFor("0.5.0");
        assert.equal(first.piCopy?.pinned, undefined);
        assert.equal((await executeUpdate(first, io)).code, 0);
        assert.equal(source(), `npm:${name}@0.5.0`);

        expected = "0.6.0";
        const second = planFor("0.6.0");
        assert.equal(second.piCopy?.pinned, true);
        assert.equal(second.piCopy?.from, "0.5.0");
        assert.equal((await executeUpdate(second, io)).code, 0);
        assert.equal(source(), `npm:${name}@0.6.0`);
        const kept = JSON.parse(readFileSync(settings, "utf8")) as {
            packages: Array<{ extensions: string[] }>;
        };
        assert.deepEqual(kept.packages[0]?.extensions, ["!plugins/jig-lens/index.ts"]);
    });
});

describe("Pi's settings writer", () => {
    test("keeps an object entry's filter when it replaces the source", () => {
        const file = path.resolve(
            import.meta.dirname,
            "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js",
        );
        const source = readFileSync(file, "utf8");
        const start = source.indexOf("addSourceToSettings(source, options) {");
        assert.ok(start >= 0, "Pi's addSourceToSettings is in the installed package");
        const block = source.slice(start, start + 1200);
        assert.match(
            block,
            /typeof existing === "string" \? normalizedSource : \{ \.\.\.existing, source: normalizedSource \}/,
            "an object entry keeps its filter; a string entry has no filter to keep",
        );
    });
});

describe("piSelfUpdateCommands", () => {
    const saved = process.env.PI_SELF_UPDATE_COMMAND;
    afterEach(() => {
        if (saved === undefined) delete process.env.PI_SELF_UPDATE_COMMAND;
        else process.env.PI_SELF_UPDATE_COMMAND = saved;
    });

    function config(overrides: Partial<PiConfigModule> = {}): PiConfigModule {
        return {
            detectInstallMethod: () => "npm",
            getSelfUpdateCommand: () => ({
                command: "npm",
                args: ["install", "-g", "@earendil-works/pi-coding-agent@1.5.0"],
                display: "npm install -g @earendil-works/pi-coding-agent@1.5.0",
            }),
            getConfiguredSelfUpdateArgv: (setting) => setting,
            makeConfiguredSelfUpdateCommand: (argv, release) => ({
                command: argv[0] ?? "",
                args: [...argv.slice(1), release.version],
                display: [...argv, release.version].join(" "),
            }),
            getSelfUpdateUnavailableInstruction: () => "Update Pi with the command that installed it.",
            ...overrides,
        };
    }

    test("uses the method Pi reports, with the exact tested version", () => {
        delete process.env.PI_SELF_UPDATE_COMMAND;
        const commands = piSelfUpdateCommands(config(), {}, "1.5.0");
        assert.ok(Array.isArray(commands));
        assert.equal(commands[0]?.command, "npm");
        assert.ok(commands[0]?.args.includes("@earendil-works/pi-coding-agent@1.5.0"));
    });

    test("uses a configured self-update command only when it can pin a version", () => {
        delete process.env.PI_SELF_UPDATE_COMMAND;
        const pinned = piSelfUpdateCommands(
            config(),
            { selfUpdateCommand: ["custom", "--version", "{version}"] },
            "1.5.0",
        );
        assert.ok(Array.isArray(pinned));
        assert.equal(pinned[0]?.command, "custom");
        const cannot = piSelfUpdateCommands(config(), { selfUpdateCommand: ["custom", "update"] }, "1.5.0");
        assert.ok(!Array.isArray(cannot));
        assert.match(cannot.problem, /without \{version\}/);
    });

    test("prints the exact instruction and stops when Pi's method cannot be handled", () => {
        delete process.env.PI_SELF_UPDATE_COMMAND;
        const commands = piSelfUpdateCommands(
            config({
                getSelfUpdateCommand: () => undefined,
                getSelfUpdateUnavailableInstruction: () => "Run: pnpm add -g @earendil-works/pi-coding-agent@1.5.0",
            }),
            {},
            "1.5.0",
        );
        assert.ok(!Array.isArray(commands));
        assert.match(commands.problem, /pnpm add -g/);
        assert.match(commands.problem, /Nothing was changed/);
    });
});

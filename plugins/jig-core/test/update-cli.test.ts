// The facts `jig update` reads before changing anything: the installed copies and company ranges, and the exact Pi command
// for the method Pi was installed by. Registry and command runs are faked in update-plan.test.ts and update-run.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { discover, piSelfUpdateCommands, update } from "../src/cli/update.ts";
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

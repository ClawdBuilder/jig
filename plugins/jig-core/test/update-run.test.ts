// Running the update plan: Pi first, then Pi's copy, then the global command, then both versions; and undo on a failure.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { InstallCommand, UpdateIo } from "../src/update-run.ts";
import { executeUpdate } from "../src/update-run.ts";
import { planUpdate } from "../src/update-plan.ts";
import type { UpdatePlan } from "../src/update-plan.ts";

function planLinked(): UpdatePlan {
    const built = planUpdate({
        name: "@clawdbuilder/jig",
        current: "0.4.1",
        target: {
            version: "0.5.0",
            release: { jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.0" } } } },
            newest: "0.5.0",
            cappedBy: [],
        },
        piVersion: "1.5.0",
        piCopy: { version: "0.4.1", source: "npm:@clawdbuilder/jig", scope: "user", folder: "/tmp/jig" },
        globalVersion: "0.3.0",
        globalLinked: true,
    });
    if (!("plan" in built)) throw new Error(built.problem);
    return built.plan;
}

function plan(withPi: boolean): UpdatePlan {
    const built = planUpdate({
        name: "@clawdbuilder/jig",
        current: "0.4.1",
        target: {
            version: "0.5.0",
            release: { jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.0" } } } },
            newest: "0.5.0",
            cappedBy: [],
        },
        piVersion: withPi ? "1.3.0" : "1.5.0",
        piCopy: { version: "0.4.1", source: "npm:@clawdbuilder/jig", scope: "user", folder: "/tmp/jig" },
        globalVersion: "0.4.1",
    });
    if (!("plan" in built)) throw new Error(built.problem);
    return built.plan;
}

interface Fake extends UpdateIo {
    calls: string[];
    versions: { pi: string; piCopy: string; global: string };
    messages: string[];
    failGlobal?: boolean;
    failUndo?: boolean;
    wrongVerify?: boolean;
    wrongPi?: boolean;
}

function fake(overrides: Partial<Fake> = {}): Fake {
    const state: Fake = {
        calls: [],
        versions: { pi: "1.3.0", piCopy: "0.4.1", global: "0.4.1" },
        messages: [],
        async run(command, args) {
            this.calls.push([command, ...args].join(" "));
            if (command === "pi-self") {
                this.versions.pi = this.wrongPi === true ? "1.4.0" : (args[0] ?? "");
                return { code: 0, stdout: "", stderr: "" };
            }
            if (command === "pi") {
                const spec = args[1] ?? "";
                const bare = spec.startsWith("npm:") ? spec.slice(4) : spec;
                const at = bare.lastIndexOf("@");
                this.versions.piCopy = at > 0 ? (bare.slice(at + 1) as string) : "0.4.1";
                return { code: 0, stdout: "", stderr: "" };
            }
            if (command === "npm") {
                if (this.failGlobal === true && args.some((arg) => arg.endsWith("@0.5.0"))) {
                    this.failGlobal = false;
                    return { code: 1, stdout: "", stderr: "EACCES: the global folder is not writable" };
                }
                if (this.failUndo === true && args.some((arg) => arg.endsWith("@0.4.1"))) {
                    return { code: 1, stdout: "", stderr: "EACCES: the old version is not writable either" };
                }
                const spec = args.at(-1) ?? "";
                this.versions.global = spec.slice(spec.lastIndexOf("@") + 1);
                return { code: 0, stdout: "", stderr: "" };
            }
            return { code: 1, stdout: "", stderr: `unexpected ${command}` };
        },
        notify(text, _level) {
            this.messages.push(text);
        },
        async confirm() {
            return true;
        },
        async piInstall(version) {
            return [{ command: "pi-self", args: [version], display: `install Pi ${version}` }];
        },
        piCopyInstall(version): InstallCommand {
            return {
                command: "pi",
                args: ["install", `npm:@clawdbuilder/jig@${version}`],
                display: `install Jig ${version}`,
            };
        },
        piCopyRestore(version): InstallCommand {
            this.versions.piCopy = version;
            return {
                command: "pi",
                args: ["install", `npm:@clawdbuilder/jig@${version}`],
                display: `restore Jig ${version}`,
            };
        },
        globalInstall(version): InstallCommand {
            return {
                command: "npm",
                args: ["install", "-g", `@clawdbuilder/jig@${version}`],
                display: `install jig ${version}`,
            };
        },
        async verify() {
            return this.wrongVerify === true
                ? { pi: this.versions.pi, piCopy: "0.4.1", global: "0.4.1" }
                : { pi: this.versions.pi, piCopy: this.versions.piCopy, global: this.versions.global };
        },
        async doctor() {
            return { code: 0, output: "Jig doctor: all checks passed" };
        },
        ...overrides,
    };
    return state;
}

describe("executeUpdate", () => {
    test("updates Pi, then Pi's copy, then the global command, and checks both", async () => {
        const io = fake();
        const result = await executeUpdate(plan(true), io);
        assert.equal(result.code, 0);
        assert.equal(result.changed, true);
        assert.deepEqual(io.calls, [
            "pi-self 1.5.0",
            "pi install npm:@clawdbuilder/jig@0.5.0",
            "npm install -g @clawdbuilder/jig@0.5.0",
        ]);
        assert.equal(io.versions.piCopy, "0.5.0");
        assert.equal(io.versions.global, "0.5.0");
        assert.match(io.messages.join("\n"), /Open Pi sessions keep the old code/);
    });

    test("a No to the Pi question changes nothing", async () => {
        const io = fake();
        io.confirm = async () => false;
        const result = await executeUpdate(plan(true), io);
        assert.equal(result.code, 0);
        assert.equal(result.changed, false);
        assert.deepEqual(io.calls, []);
        assert.match(io.messages.join("\n"), /Nothing was changed/);
    });

    test("a failed global step puts Pi's copy and Pi back", async () => {
        const io = fake({ failGlobal: true });
        const result = await executeUpdate(plan(true), io);
        assert.equal(result.code, 1);
        assert.equal(result.changed, false);
        assert.deepEqual(io.calls, [
            "pi-self 1.5.0",
            "pi install npm:@clawdbuilder/jig@0.5.0",
            "npm install -g @clawdbuilder/jig@0.5.0",
            "npm install -g @clawdbuilder/jig@0.4.1",
            "pi install npm:@clawdbuilder/jig@0.4.1",
            "pi-self 1.3.0",
        ]);
        assert.equal(io.versions.pi, "1.3.0");
        assert.equal(io.versions.piCopy, "0.4.1");
        assert.equal(io.versions.global, "0.4.1");
        assert.match(io.messages.join("\n"), /Put Pi's Jig copy 0\.4\.1 back/);
        assert.match(io.messages.join("\n"), /Every copy was put back/);
    });

    test("a failed undo means something did change, so the result says changed", async () => {
        const io = fake({ failGlobal: true, failUndo: true });
        const result = await executeUpdate(plan(true), io);
        assert.equal(result.code, 1);
        assert.equal(result.changed, true);
        assert.match(io.messages.join("\n"), /Could not put the jig command 0\.4\.1 back/);
        assert.match(io.messages.join("\n"), /Some versions could not be put back/);
    });

    test("a version that does not match is a failure and is undone", async () => {
        const io = fake({ wrongVerify: true });
        const result = await executeUpdate(plan(false), io);
        assert.equal(result.code, 1);
        assert.match(io.messages.join("\n"), /versions do not match/);
        assert.ok(io.calls.includes("pi install npm:@clawdbuilder/jig@0.4.1"));
        assert.ok(io.calls.includes("npm install -g @clawdbuilder/jig@0.4.1"));
    });

    test("a linked global command is not verified against the target", async () => {
        const io = fake();
        const result = await executeUpdate(planLinked(), io);
        assert.equal(result.code, 0);
        assert.equal(io.versions.global, "0.4.1", "the linked command keeps its version");
        assert.ok(!io.calls.some((call) => call.startsWith("npm install")));
        assert.equal(io.versions.piCopy, "0.5.0");
    });

    test("a Pi that ignores the requested version fails the update and is undone", async () => {
        const io = fake({ wrongPi: true });
        const result = await executeUpdate(plan(true), io);
        assert.equal(result.code, 1);
        assert.match(io.messages.join("\n"), /not the tested 1\.5\.0/);
        assert.ok(io.calls.includes("pi-self 1.3.0"));
    });

    test("an interruption after a step still runs and verifies the undo", async () => {
        const controller = new AbortController();
        const io = fake();
        const run = io.run.bind(io);
        io.run = async (command, args, signal) => {
            const result = await run(command, args, signal);
            if (command === "pi-self" && args[0] === "1.5.0") controller.abort();
            return result;
        };
        const result = await executeUpdate(plan(true), io, controller.signal);
        assert.equal(result.code, 1);
        assert.equal(result.changed, false);
        assert.ok(io.calls.includes("pi-self 1.3.0"));
        assert.match(io.messages.join("\n"), /Put Pi 1\.3\.0 back/);
    });

    test("an interruption before a step changes nothing", async () => {
        const controller = new AbortController();
        controller.abort();
        const io = fake();
        const result = await executeUpdate(plan(true), io, controller.signal);
        assert.equal(result.code, 1);
        assert.equal(result.changed, false);
        assert.deepEqual(io.calls, []);
        assert.match(io.messages.join("\n"), /Update interrupted/);
    });

    test("an undo that reports the wrong version prints the exact manual commands", async () => {
        const io = fake({ failGlobal: true });
        const run = io.run.bind(io);
        io.run = async (command, args, signal) => {
            const result = await run(command, args, signal);
            if (command === "pi" && args[1]?.includes("0.4.1")) {
                io.versions.piCopy = "0.3.0";
            }
            return result;
        };
        const result = await executeUpdate(plan(true), io);
        assert.equal(result.code, 1);
        assert.match(io.messages.join("\n"), /not 0\.4\.1/);
        assert.match(io.messages.join("\n"), /run: pi install npm:@clawdbuilder\/jig@0\.4\.1/);
    });

    test("nothing to do runs nothing", async () => {
        const io = fake();
        const built = planUpdate({
            name: "@clawdbuilder/jig",
            current: "0.5.0",
            target: {
                version: "0.5.0",
                release: { jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.0" } } } },
                newest: "0.5.0",
                cappedBy: [],
            },
            piVersion: "1.5.0",
            piCopy: { version: "0.5.0", source: "npm:@clawdbuilder/jig", scope: "user", folder: "/tmp/jig" },
            globalVersion: "0.5.0",
        });
        assert.ok("plan" in built);
        const result = await executeUpdate(built.plan, io);
        assert.equal(result.code, 0);
        assert.equal(result.changed, false);
        assert.deepEqual(io.calls, []);
    });
});

// `jig lens` with no Pi: one plain line for each of the last calls, read from the records through the index. Most cases run
// the command in this process with the records of a temporary state folder; the last ones start it in a child process whose
// first import is the guard of test/support/no-pi.mjs, which refuses every Pi package, so the command's files are shown to
// load and run where Pi is not installed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";
import { NO_CALLS, RECENT_CALLS, run } from "../src/cli.ts";
import { appendLines, call, NOW, tempState, turn, writeRecords } from "./support.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CLI = path.join(ROOT, "plugins/jig-lens/src/cli.ts");
const NO_PI = path.join(ROOT, "test/support/no-pi.mjs");

/** The command run in this process: its exit code and what it printed on each stream. */
async function lens(state: string, args: string[] = []) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(args, {
        env: { JIG_STATE_DIR: state },
        now: NOW,
        out: (text) => out.push(text),
        err: (text) => err.push(text),
    });
    return { code, out: out.join(""), err: err.join("") };
}

/** The cells of each line, which the command lines up with two or more spaces. */
const cells = (text: string): string[][] =>
    text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split(/ {2,}/));

describe("jig lens", () => {
    test("with no calls prints one line that says so, and exits 0", async (t) => {
        const result = await lens(tempState(t));
        assert.equal(result.code, 0);
        assert.equal(result.out, `${NO_CALLS}\n`);
        assert.equal(result.err, "");
    });

    test("a state folder with turns and no calls says there are no calls", async (t) => {
        const state = tempState(t);
        writeRecords(state, [turn("t1", "2026-10-30T09:00:00Z", "s1", "model-a", 0.1)]);
        assert.equal((await lens(state)).out, `${NO_CALLS}\n`);
    });

    test("prints one line for each call: time, agent, tool, action, decision, outcome and enforcement", async (t) => {
        const state = tempState(t);
        writeRecords(state, [
            call("c1", "2026-10-30T10:00:00Z", "s1", "pr", {
                action: "list",
                agentName: "claude-code",
                enforcedBy: "gateway",
            }),
            call("c2", "2026-10-30T10:01:00Z", "s1", "pr", {
                action: "comment",
                effect: "write",
                decision: "deny",
                decisionSource: "floor",
                outcome: "blocked",
                errorKind: "no-screen",
                agentName: "claude-code",
                enforcedBy: "gateway",
            }),
        ]);
        const result = await lens(state);
        assert.equal(result.code, 0);
        assert.deepEqual(cells(result.out), [
            ["2026-10-30T10:00:00Z", "claude-code", "pr", "list", "allow", "ok", "gateway"],
            ["2026-10-30T10:01:00Z", "claude-code", "pr", "comment", "deny", "blocked", "gateway"],
        ]);
        assert.equal(result.err, "");
    });

    test("shows a dash where the record has no value: an older line, a call made in Pi, a tool with no action", async (t) => {
        const state = tempState(t);
        writeRecords(state, [
            // Written before the two fields existed: neither is there.
            call("c1", "2026-10-30T10:00:00Z", "s1", "bash"),
            // Made in Pi: it has the agent and no enforcement point.
            call("c2", "2026-10-30T10:01:00Z", "s1", "git", { action: "status", agentName: "pi" }),
            // Never classified, so no decision either.
            call("c3", "2026-10-30T10:02:00Z", "s1", "mystery", {
                decision: undefined,
                outcome: "error",
                errorKind: "not-run",
            }),
        ]);
        assert.deepEqual(cells((await lens(state)).out), [
            ["2026-10-30T10:00:00Z", "-", "bash", "-", "allow", "ok", "-"],
            ["2026-10-30T10:01:00Z", "pi", "git", "status", "allow", "ok", "-"],
            ["2026-10-30T10:02:00Z", "-", "mystery", "-", "-", "error", "-"],
        ]);
    });

    test("prints the last 20 calls, the oldest of them first", async (t) => {
        const state = tempState(t);
        const minute = (n: number) => `2026-10-30T09:${String(n).padStart(2, "0")}:00Z`;
        writeRecords(
            state,
            Array.from({ length: 25 }, (_, n) => call(`c${n}`, minute(n), "s1", `tool${n}`)),
        );
        const rows = cells((await lens(state)).out);
        assert.equal(RECENT_CALLS, 20);
        assert.equal(rows.length, 20);
        assert.deepEqual(rows[0]?.slice(0, 3), [minute(5), "-", "tool5"]);
        assert.deepEqual(rows[19]?.slice(0, 3), [minute(24), "-", "tool24"]);
    });

    test("imports only what is new: a second run prints the same, and a record written since is added", async (t) => {
        const state = tempState(t);
        const file = appendLines(state, "2026-10-30", [
            JSON.stringify(call("c1", "2026-10-30T10:00:00Z", "s1", "read")),
        ]);
        const first = await lens(state);
        assert.equal((await lens(state)).out, first.out);
        appendFileSync(file, `${JSON.stringify(call("c2", "2026-10-30T10:05:00Z", "s1", "edit"))}\n`);
        const rows = cells((await lens(state)).out);
        assert.deepEqual(
            rows.map((row) => row[2]),
            ["read", "edit"],
        );
    });

    test("a name from the records is made safe to print", async (t) => {
        const state = tempState(t);
        writeRecords(state, [call("c1", "2026-10-30T10:00:00Z", "s1", "evil\u001b[2Jtool", { agentName: "x" })]);
        const { out } = await lens(state);
        assert.equal(out.includes("\u001b"), false);
        assert.match(out, /evil\?\[2Jtool/);
    });

    test("a line that is not a record is skipped, and the calls around it are shown", async (t) => {
        const state = tempState(t);
        appendLines(state, "2026-10-30", [
            JSON.stringify(call("c1", "2026-10-30T10:00:00Z", "s1", "read")),
            "this is not json",
            JSON.stringify(call("c2", "2026-10-30T10:01:00Z", "s1", "edit")),
        ]);
        const result = await lens(state);
        assert.equal(result.code, 0);
        assert.equal(cells(result.out).length, 2);
    });

    test("makes its index in the state folder, as `/lens` does, and changes no record", async (t) => {
        const state = tempState(t);
        const file = appendLines(state, "2026-10-30", [
            JSON.stringify(call("c1", "2026-10-30T10:00:00Z", "s1", "read")),
        ]);
        const before = readFileSync(file, "utf8");
        await lens(state);
        assert.equal(existsSync(path.join(state, "lens", "index.sqlite")), true);
        assert.equal(readFileSync(file, "utf8"), before);
    });

    test("refuses a word it does not take, and says how to ask Pi; an option it does not have, and says where the help is", async (t) => {
        const state = tempState(t);
        const word = await lens(state, ["days", "3"]);
        assert.equal(word.code, 2);
        assert.equal(word.out, "");
        assert.equal(word.err, 'jig lens takes no words like "days". To ask Pi, run: jig "lens days 3"\n');
        const option = await lens(state, ["--days"]);
        assert.equal(option.code, 2);
        assert.equal(option.out, "");
        assert.equal(option.err, "jig lens: unknown option --days.\nRun jig lens --help for usage.\n");
    });
});

describe("jig lens in a process that has no Pi", () => {
    /** Runs the command in a child whose first import is the guard. The guard gives the child its own empty state folder, so the
     *  child writes the record lines there itself, before it starts the command. */
    function inChild(lines: readonly string[], args: readonly string[] = []) {
        const script = `
            import { mkdirSync, writeFileSync } from "node:fs";
            import { join } from "node:path";
            const records = join(process.env.JIG_STATE_DIR, "records");
            mkdirSync(records, { recursive: true });
            writeFileSync(join(records, "2026-10-30.jsonl"), ${JSON.stringify(lines.map((line) => `${line}\n`).join(""))});
            const { run } = await import(${JSON.stringify(pathToFileURL(CLI).href)});
            process.exitCode = await run(${JSON.stringify(args)});
        `;
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        // Pi must not be findable either, in case the guard were gone.
        delete env.PI_HOST_DIR;
        return spawnSync(process.execPath, ["--import", NO_PI, "--input-type=module", "-e", script], {
            cwd: ROOT,
            env,
            encoding: "utf8",
            timeout: 60_000,
        });
    }

    test("prints the calls with the agent and the enforcement point", () => {
        const lines = [
            call("c1", "2026-10-30T10:00:00Z", "s1", "pr", {
                action: "list",
                agentName: "claude-code",
                enforcedBy: "gateway",
            }),
            call("c2", "2026-10-30T10:01:00Z", "s1", "bash"),
        ].map((record) => JSON.stringify(record));
        const child = inChild(lines);
        assert.equal(child.status, 0, child.stderr);
        assert.deepEqual(cells(child.stdout), [
            ["2026-10-30T10:00:00Z", "claude-code", "pr", "list", "allow", "ok", "gateway"],
            ["2026-10-30T10:01:00Z", "-", "bash", "-", "allow", "ok", "-"],
        ]);
    });

    test("says there are no calls when the records hold none", () => {
        const child = inChild([]);
        assert.equal(child.status, 0, child.stderr);
        assert.equal(child.stdout, `${NO_CALLS}\n`);
    });

    test("the guard is on: the same child cannot load a Pi package", () => {
        const refused = spawnSync(
            process.execPath,
            ["--import", NO_PI, "--input-type=module", "-e", 'await import("@earendil-works/pi-tui")'],
            { cwd: ROOT, encoding: "utf8", timeout: 60_000 },
        );
        assert.notEqual(refused.status, 0);
        assert.match(refused.stderr, /was imported in a process that has no Pi/);
    });
});

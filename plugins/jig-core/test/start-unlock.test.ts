// Unlocking the secret store when a session starts: which entry it opens, what it tells the user, and when it does not run.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { RunResult } from "../src/contract.ts";
import { SecretError } from "../src/secrets.ts";
import { findPassEntry, PROMPT_AFTER_MS, STILL_LOCKED, UNLOCKED, unlockStoreAtStart } from "../src/start-unlock.ts";
import type { UnlockJob } from "../src/start-unlock.ts";
import { fakeClock } from "./support/clock.ts";
import type { FakeClock } from "./support/clock.ts";
import { start } from "./support/harness.ts";
import type { Harness, StartOptions } from "./support/harness.ts";
import { tempState } from "./support/state.ts";

const state = tempState();
let root = "";
let store = "";
beforeEach(() => {
    state.start();
    root = mkdtempSync(path.join(tmpdir(), "jig-unlock-"));
    store = path.join(root, "store");
    mkdirSync(store);
});
afterEach(() => {
    state.stop();
    rmSync(root, { recursive: true, force: true });
});

/** Makes the files of a store: each name is an entry (`work/token`) and becomes `work/token.gpg`; other names are kept as they are. */
function fill(...names: string[]): void {
    for (const name of names) {
        const file = path.join(store, name.includes(".") ? name : `${name}.gpg`);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, "not really encrypted");
    }
}

describe("finding an entry to open", () => {
    test("takes the shallowest entry, the first in name order", async () => {
        fill("zeta/deep/one", "beta/two", "alpha/three", "top-b", "top-a");
        assert.equal(await findPassEntry(store), "top-a");
        rmSync(path.join(store, "top-a.gpg"));
        rmSync(path.join(store, "top-b.gpg"));
        assert.equal(await findPassEntry(store), "alpha/three");
    });

    test("goes down only when a folder has none of its own, and reads the nearest folder first", async () => {
        fill("a/b/c/d/deep", "z/near");
        assert.equal(await findPassEntry(store), "z/near");
        rmSync(path.join(store, "z"), { recursive: true });
        assert.equal(await findPassEntry(store), "a/b/c/d/deep");
    });

    test("skips what is not an entry: dot names, other files, links, and names a lookup would refuse", async () => {
        fill(".git/objects/x", ".gpg-id", ".extensions/e", "notes.txt", "readme.md", "has space", "plain.gpg.bak");
        writeFileSync(path.join(root, "outside.gpg"), "x");
        symlinkSync(path.join(root, "outside.gpg"), path.join(store, "linked.gpg"));
        mkdirSync(path.join(root, "outside-dir"));
        writeFileSync(path.join(root, "outside-dir", "inside.gpg"), "x");
        symlinkSync(path.join(root, "outside-dir"), path.join(store, "linked-dir"));
        assert.equal(await findPassEntry(store), undefined);
        fill("real/entry");
        assert.equal(await findPassEntry(store), "real/entry");
    });

    test("a store that is empty, missing or unreadable has none", async () => {
        assert.equal(await findPassEntry(store), undefined);
        assert.equal(await findPassEntry(path.join(root, "missing")), undefined);
        writeFileSync(path.join(root, "a-file"), "x");
        assert.equal(await findPassEntry(path.join(root, "a-file")), undefined);
    });

    test("reads a bounded number of folders", async () => {
        for (let n = 0; n < 250; n++) mkdirSync(path.join(store, `d${String(n).padStart(3, "0")}`));
        fill("d249/late");
        assert.equal(await findPassEntry(store), undefined, "an entry behind 200 empty folders is not looked for");
    });
});

describe("what it tells the user", () => {
    /** A job whose store has one entry, and whose unlock does what `unlock` says. */
    function job(unlock: (entry: string) => Promise<void>, clock: FakeClock = fakeClock()) {
        const said: Array<[string, string]> = [];
        const asked: string[] = [];
        const control = new AbortController();
        const result: UnlockJob = {
            secrets: {
                passStoreDir: () => store,
                async unlockPass(entry) {
                    asked.push(entry);
                    await unlock(entry);
                },
            },
            notify: (message, level) => said.push([message, level]),
            now: clock.now,
            signal: control.signal,
        };
        return { job: result, said, asked, control, clock };
    }

    test("an unlocked store opens at once, and nothing is said", async () => {
        fill("work/token");
        const { job: j, said, asked } = job(async () => undefined);
        await unlockStoreAtStart(j);
        assert.deepEqual(asked, ["work/token"]);
        assert.deepEqual(said, []);
    });

    test("a store that needed a prompt says it is unlocked, once the prompt was answered", async () => {
        fill("work/token");
        const clock = fakeClock();
        const { job: j, said } = job(() => clock.advance(PROMPT_AFTER_MS + 1), clock);
        await unlockStoreAtStart(j);
        assert.deepEqual(said, [[UNLOCKED, "info"]]);
        assert.equal(UNLOCKED, "secret store unlocked");
    });

    test("an entry that opens just under the limit counts as already unlocked", async () => {
        fill("work/token");
        const clock = fakeClock();
        const { job: j, said } = job(() => clock.advance(PROMPT_AFTER_MS - 1), clock);
        await unlockStoreAtStart(j);
        assert.deepEqual(said, []);
    });

    test("a store that stays locked says so, and says that a tool will ask again", async () => {
        fill("work/token");
        const { job: j, said } = job(async () => {
            throw new SecretError("locked", "the pass store is locked");
        });
        await unlockStoreAtStart(j);
        assert.deepEqual(said, [[STILL_LOCKED, "warning"]]);
        assert.equal(STILL_LOCKED, "secret store still locked; a tool that needs it will ask again");
    });

    test("a missing or empty store says nothing and opens nothing", async () => {
        const { job: j, said, asked } = job(async () => undefined);
        await unlockStoreAtStart(j);
        rmSync(store, { recursive: true });
        await unlockStoreAtStart(j);
        assert.deepEqual([said, asked], [[], []]);
    });

    test("any other failure is left for the tool that needs the store", async () => {
        fill("work/token");
        for (const code of ["missing", "unavailable", "invalid_ref", "backend_disabled"] as const) {
            const { job: j, said } = job(async () => {
                throw new SecretError(code, "no");
            });
            await unlockStoreAtStart(j);
            assert.deepEqual(said, [], code);
        }
    });

    test("it never throws, whatever the parts do", async () => {
        fill("work/token");
        const { job: j, said } = job(async () => {
            throw new TypeError("not a secret error");
        });
        await unlockStoreAtStart(j);
        await unlockStoreAtStart({
            ...j,
            secrets: {
                passStoreDir: () => {
                    throw new Error("no folder");
                },
                unlockPass: async () => undefined,
            },
        });
        await unlockStoreAtStart({
            ...j,
            notify: () => {
                throw new Error("the screen is gone");
            },
            secrets: {
                passStoreDir: () => store,
                unlockPass: async () => {
                    throw new SecretError("locked", "x");
                },
            },
        });
        assert.deepEqual(said, []);
    });

    test("once the session has ended it says nothing", async () => {
        fill("work/token");
        const clock = fakeClock();
        const ended = job(() => clock.advance(5000), clock);
        const unlocking = unlockStoreAtStart(ended.job);
        ended.control.abort();
        await unlocking;
        const locked = job(async () => {
            throw new SecretError("locked", "x");
        });
        locked.control.abort();
        await unlockStoreAtStart(locked.job);
        assert.deepEqual([ended.said, locked.said, locked.asked], [[], [], []]);
    });

    test("what it says holds no entry name, no value and nothing pass printed", async () => {
        fill("secret-looking/entry-name");
        const { job: j, said } = job(async () => {
            throw new SecretError("locked", "the pass store is locked");
        });
        await unlockStoreAtStart(j);
        assert.ok(!JSON.stringify(said).includes("entry-name"));
    });
});

describe("in a session", () => {
    let harness: Harness | undefined;
    afterEach(async () => {
        await harness?.shutdown();
        harness = undefined;
    });

    interface Call {
        entry: string | undefined;
        args: readonly string[];
        env: Record<string, string> | undefined;
    }
    const open = (): RunResult => ({ code: 0, stdout: "first line\nsecond line\n", stderr: "", timedOut: false });
    const locked = (): RunResult => ({
        code: 2,
        stdout: "",
        stderr: "gpg: decryption failed: No secret key",
        timedOut: false,
    });

    /** Starts a session with `unlockAtStart` on and a fake `pass` that answers as `answer` says. */
    async function begin(
        answer: (call: Call, calls: Call[]) => Promise<RunResult> | RunResult = open,
        over: Partial<StartOptions> & { config?: Record<string, unknown> } = {},
    ) {
        const calls: Call[] = [];
        const { config, ...rest } = over;
        harness = await start({
            config: {
                secrets: { pass: { storeDir: store, unlockAtStart: true } },
                ...config,
            },
            runProgram: async (file, args, options) => {
                assert.equal(file, "pass");
                const call: Call = {
                    entry: args[1],
                    args,
                    env: options?.env as Record<string, string> | undefined,
                };
                calls.push(call);
                return answer(call, calls);
            },
            ...rest,
        });
        return { harness, calls };
    }
    const until = async (done: () => boolean, ms = 3000): Promise<void> => {
        const end = Date.now() + ms;
        while (!done()) {
            if (Date.now() > end) assert.fail("timed out waiting");
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    };
    const idle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    /** What the user was told, apart from the sandbox line every session start gives. */
    const told = (h: Harness) => h.ui.notifications.filter((entry) => !entry.message.startsWith("bash:"));

    test("opens one entry of the store the settings name, in the background, and an unlocked store is silent", async () => {
        fill("work/token", "zeta/other");
        const { calls, harness: h } = await begin();
        await until(() => calls.length > 0);
        await idle();
        assert.deepEqual(
            calls.map((call) => call.args),
            [["show", "work/token"]],
        );
        assert.equal(calls[0]?.env?.PASSWORD_STORE_DIR, store);
        assert.deepEqual(told(h), []);
        assert.deepEqual(h.host.sent, []);
        assert.deepEqual(h.host.userMessages, []);
        assert.deepEqual(h.host.entries, []);
    });

    test("uses the store pass would use: the settings, then the environment, then ~/.password-store", async () => {
        fill("viaenv/entry");
        const { calls } = await begin(open, {
            config: { secrets: { pass: { unlockAtStart: true } } },
            env: { PASSWORD_STORE_DIR: store },
        });
        await until(() => calls.length > 0);
        assert.deepEqual(calls[0]?.args, ["show", "viaenv/entry"]);
    });

    test("a store that was locked and is now unlocked says so; the session did not wait for the prompt", async () => {
        fill("work/token");
        const clock = fakeClock();
        let release: () => void = () => undefined;
        const prompt = new Promise<void>((resolve) => {
            release = resolve;
        });
        const { harness: h } = await begin(
            async () => {
                await prompt;
                await clock.advance(8000);
                return open();
            },
            { clock },
        );
        assert.deepEqual(told(h), [], "the session started while the prompt was still open");
        release();
        await until(() => told(h).length > 0);
        assert.deepEqual(told(h), [{ message: UNLOCKED, type: "info" }]);
    });

    test("a store that stays locked says so", async () => {
        fill("work/token");
        const { harness: h } = await begin(locked);
        await until(() => told(h).length > 0);
        assert.deepEqual(told(h), [{ message: STILL_LOCKED, type: "warning" }]);
    });

    test("session start does not wait for it", async () => {
        fill("work/token");
        const { calls } = await begin(() => new Promise<RunResult>(() => undefined));
        await until(() => calls.length > 0);
        assert.equal(calls.length, 1, "pass was asked, and has not answered, and the session already started");
    });

    test("a tool that asks for another entry meanwhile waits for the unlock, and then finds the store open", async () => {
        fill("work/token");
        let release: () => void = () => undefined;
        const prompt = new Promise<void>((resolve) => {
            release = resolve;
        });
        let unlocked = false;
        const { harness: h, calls } = await begin(async (call) => {
            if (call.entry === "work/token") {
                await prompt;
                unlocked = true;
            }
            assert.ok(unlocked, "the second lookup ran while the store was still locked");
            return open();
        });
        await until(() => calls.length === 1);
        const wanted = h.api.secrets.resolve("pass:other/entry");
        await idle();
        assert.equal(calls.length, 1, "it has not started: pass is busy asking once");
        release();
        assert.equal(await wanted, "first line");
        assert.deepEqual(
            calls.map((call) => call.entry),
            ["work/token", "other/entry"],
        );
    });

    test("it does not run when the setting is off or missing", async () => {
        fill("work/token");
        for (const pass of [{ storeDir: store }, { storeDir: store, unlockAtStart: false }]) {
            const { calls, harness: h } = await begin(open, { config: { secrets: { pass } } });
            await idle();
            assert.deepEqual([calls.length, told(h)], [0, []]);
            await h.shutdown();
            harness = undefined;
        }
    });

    test("it does not run when pass is not an enabled backend", async () => {
        fill("work/token");
        for (const secrets of [
            { backends: ["env"], pass: { storeDir: store, unlockAtStart: true } },
            { disabledBackends: ["pass"], pass: { storeDir: store, unlockAtStart: true } },
        ]) {
            const { calls, harness: h } = await begin(open, { config: { secrets } });
            await idle();
            assert.deepEqual([calls.length, told(h)], [0, []]);
            await h.shutdown();
            harness = undefined;
        }
    });

    test("it does not run without a screen, in print or RPC mode with no UI", async () => {
        fill("work/token");
        for (const mode of ["print", "rpc"] as const) {
            const { calls } = await begin(open, { ui: false, mode });
            await idle();
            assert.equal(calls.length, 0, mode);
            await harness?.shutdown();
            harness = undefined;
        }
    });

    test("it does not run in a child agent, however the child is marked", async () => {
        fill("work/token");
        for (const env of [{ PI_SUBAGENT_ID: "child-1" }, { PI_SUBAGENT_CHILD: "1" }]) {
            const { calls } = await begin(open, { env: { ...env, PASSWORD_STORE_DIR: store } });
            await idle();
            assert.equal(calls.length, 0, JSON.stringify(env));
            await harness?.shutdown();
            harness = undefined;
        }
    });

    test("a blank marker does not make a top-level session a child", async () => {
        fill("work/token");
        const { calls } = await begin(open, { env: { PI_SUBAGENT_ID: "  ", PI_SUBAGENT_CHILD: "0" } });
        await until(() => calls.length > 0);
    });

    test("an empty store says nothing and opens nothing", async () => {
        const { calls, harness: h } = await begin();
        await idle();
        assert.deepEqual([calls.length, told(h)], [0, []]);
    });

    test("once the session has ended a late answer says nothing", async () => {
        fill("work/token");
        const clock = fakeClock();
        let release: () => void = () => undefined;
        const prompt = new Promise<void>((resolve) => {
            release = resolve;
        });
        const { harness: h, calls } = await begin(
            async () => {
                await prompt;
                await clock.advance(8000);
                return locked();
            },
            { clock },
        );
        await until(() => calls.length > 0);
        await h.shutdown();
        release();
        await idle();
        assert.deepEqual(told(h), []);
    });

    test("starting the session again stops the earlier work and starts it anew", async () => {
        fill("work/token");
        const { harness: h, calls } = await begin();
        await until(() => calls.length === 1);
        await idle();
        await h.host.fire("session_start", { reason: "reload" }, h.ctx);
        await until(() => calls.length === 2);
    });
});

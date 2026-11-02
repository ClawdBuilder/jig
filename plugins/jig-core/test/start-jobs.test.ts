// The start checks in a session: when they run, what the user is told, and what /jig shows. (The unlock has its own file.)
import assert from "node:assert/strict";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { afterEach, beforeEach, describe, test } from "node:test";
import { freePort } from "../src/kit/ports.ts";
import type { Connector } from "../src/start-checks.ts";
import { isChildAgent } from "../src/start-jobs.ts";
import { fakeClock } from "./support/clock.ts";
import { start } from "./support/harness.ts";
import type { Harness, StartOptions } from "./support/harness.ts";
import { tempState } from "./support/state.ts";

const state = tempState();
beforeEach(() => state.start());

let harness: Harness | undefined;
const servers: Server[] = [];
afterEach(async () => {
    await harness?.shutdown();
    harness = undefined;
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    state.stop();
});

const idle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (done: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms;
    while (!done()) {
        if (Date.now() > end) assert.fail("timed out waiting");
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
};
/** What the user was told, apart from the sandbox line every session start gives. */
const told = (h: Harness) => h.ui.notifications.filter((entry) => !entry.message.startsWith("bash:"));

interface Asked {
    host: string;
    port: number;
    signal: AbortSignal;
    answer(reached: boolean): void;
}

/** A connector the test answers by hand. */
function manual() {
    const asked: Asked[] = [];
    const connect: Connector = (host, port, signal) =>
        new Promise<boolean>((resolve) => {
            asked.push({ host, port, signal, answer: resolve });
        });
    return { asked, connect };
}

/** A connector that answers from a table of what is up, by `host:port`. */
function table(up: string[]) {
    const asked: string[] = [];
    const connect: Connector = async (host, port) => {
        asked.push(`${host}:${port}`);
        return up.includes(`${host}:${port}`);
    };
    return { asked, connect };
}

async function begin(startChecks: unknown, options: StartOptions = {}): Promise<Harness> {
    harness = await start({ config: { startChecks }, ...options });
    return harness;
}

const VPN = { name: "VPN", tcp: "vpn.example.com:443", hint: "connect your VPN client" };
const ORDERS = { name: "Orders API", tcp: "orders-api.staging.example.com:8443" };

/** Runs `/jig` and returns what it showed. */
async function jigStatus(h: Harness): Promise<string> {
    const before = [h.ui.notifications.length, h.ui.selects.length] as const;
    const command = h.host.commands.get("jig");
    assert.ok(command, "/jig is registered");
    await command.handler("", h.ctx as never);
    return [
        ...h.ui.notifications.slice(before[0]).map((entry) => entry.message),
        ...h.ui.selects.slice(before[1]).map((entry) => entry.options.join("\n")),
    ].join("\n");
}

describe("a child agent is told by the variable jig-agents sets", () => {
    test("PI_SUBAGENT_ID, or the older PI_SUBAGENT_CHILD=1; blanks and other values are not a marker", () => {
        assert.equal(isChildAgent({ PI_SUBAGENT_ID: "abc123" }), true);
        assert.equal(isChildAgent({ PI_SUBAGENT_CHILD: "1" }), true);
        for (const env of [
            {},
            { PI_SUBAGENT_ID: "" },
            { PI_SUBAGENT_ID: "   " },
            { PI_SUBAGENT_CHILD: "0" },
            { PI_SUBAGENT_CHILD: "true" },
        ])
            assert.equal(isChildAgent(env), false, JSON.stringify(env));
    });
});

describe("when a session starts", () => {
    test("each check that cannot be reached is one notice with its name, address and hint; the others say nothing", async () => {
        const { connect, asked } = table(["orders-api.staging.example.com:8443"]);
        const h = await begin([VPN, ORDERS], { connect });
        await until(() => told(h).length > 0);
        await idle();
        assert.deepEqual(told(h), [
            { message: "VPN is not reachable (vpn.example.com:443): connect your VPN client", type: "warning" },
        ]);
        assert.deepEqual(asked.sort(), ["orders-api.staging.example.com:8443", "vpn.example.com:443"]);
    });

    test("with every check reachable nothing is said, and with several failing there is a notice for each", async () => {
        const up = table([VPN.tcp, ORDERS.tcp]);
        const h = await begin([VPN, ORDERS], { connect: up.connect });
        await until(() => up.asked.length === 2);
        await idle();
        assert.deepEqual(told(h), []);
        await h.shutdown();
        const down = table([]);
        const second = await begin([VPN, ORDERS, { name: "Third", tcp: "[::1]:9" }], { connect: down.connect });
        await until(() => told(second).length === 3);
        assert.deepEqual(
            told(second)
                .map((entry) => entry.message)
                .sort(),
            [
                "Orders API is not reachable (orders-api.staging.example.com:8443)",
                "Third is not reachable ([::1]:9)",
                "VPN is not reachable (vpn.example.com:443): connect your VPN client",
            ],
        );
    });

    test("the connections are made at once, and the session does not wait for them", async () => {
        const { asked, connect } = manual();
        const h = await begin([VPN, ORDERS], { connect });
        await until(() => asked.length === 2);
        assert.deepEqual(told(h), [], "the session has started and no check has answered");
        assert.deepEqual(h.host.sent, []);
        for (const call of asked) call.answer(true);
    });

    test("a real open port is quiet and a real closed port is one notice", async () => {
        const server = createServer((socket) => socket.destroy());
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const open = (server.address() as { port: number }).port;
        const shut = await freePort();
        const h = await begin([
            { name: "Up", tcp: `127.0.0.1:${open}` },
            { name: "Down", tcp: `127.0.0.1:${shut}`, hint: "start it" },
        ]);
        await until(() => told(h).length > 0);
        await idle();
        assert.deepEqual(told(h), [
            { message: `Down is not reachable (127.0.0.1:${shut}): start it`, type: "warning" },
        ]);
    });

    test("a check that does not answer is a notice at three seconds, with one attempt and no retry", async () => {
        const clock = fakeClock();
        const { asked, connect } = manual();
        const h = await begin([VPN], { connect, clock });
        await until(() => asked.length === 1);
        await clock.advance(2999);
        assert.deepEqual(told(h), []);
        assert.equal(asked[0]?.signal.aborted, false);
        await clock.advance(1);
        assert.deepEqual(told(h), [
            { message: "VPN is not reachable (vpn.example.com:443): connect your VPN client", type: "warning" },
        ]);
        assert.equal(asked[0]?.signal.aborted, true, "the connection is told to stop");
        await clock.advance(60_000);
        assert.equal(asked.length, 1, "no second attempt");
    });

    test("what the user is told never reaches the model", async () => {
        const h = await begin([VPN], { connect: table([]).connect });
        await until(() => told(h).length > 0);
        assert.deepEqual([h.host.sent, h.host.userMessages, h.host.entries], [[], [], []]);
    });
});

describe("when they do not run", () => {
    test("not without a screen, in print mode or in RPC mode with no UI", async () => {
        for (const mode of ["print", "rpc"] as const) {
            const { asked, connect } = table([]);
            await begin([VPN], { connect, ui: false, mode });
            await idle();
            assert.deepEqual(asked, [], mode);
            await harness?.shutdown();
            harness = undefined;
        }
    });

    test("not in a child agent, however it is marked", async () => {
        for (const env of [{ PI_SUBAGENT_ID: "child-1" }, { PI_SUBAGENT_CHILD: "1" }]) {
            const { asked, connect } = table([]);
            await begin([VPN], { connect, env });
            await idle();
            assert.deepEqual(asked, [], JSON.stringify(env));
            await harness?.shutdown();
            harness = undefined;
        }
    });

    test("not when the list is empty or missing", async () => {
        const { asked, connect } = table([]);
        await begin([], { connect });
        await harness?.shutdown();
        harness = await start({ connect });
        await idle();
        assert.deepEqual(asked, []);
    });

    test("not when the list is wrong: the problem is shown and nothing is probed", async () => {
        const { asked, connect } = table([]);
        const h = await begin([VPN, { name: "Bad", tcp: "no-port.example.com" }], { connect });
        await idle();
        assert.deepEqual(asked, []);
        assert.match(await jigStatus(h), /jig\.json: startChecks\[1\]\.tcp: must be host:port/);
    });

    test("a company plugin cannot add checks, by a section or by defaults", async () => {
        const { asked, connect } = table([]);
        await begin([], {
            connect,
            plugins: (api) => {
                assert.throws(() => api.config.registerSection("startChecks", () => []), /jig-core field/);
                assert.throws(
                    () => api.config.addSectionDefaults("startChecks", [{ name: "x", tcp: "h.example.com:1" }]),
                    /jig-core field/,
                );
            },
        });
        await idle();
        assert.deepEqual(asked, []);
    });

    test("when the session ends the checks are told to stop, and a late answer says nothing", async () => {
        const { asked, connect } = manual();
        const h = await begin([VPN, ORDERS], { connect });
        await until(() => asked.length === 2);
        await h.shutdown();
        assert.deepEqual(
            asked.map((call) => call.signal.aborted),
            [true, true],
        );
        for (const call of asked) call.answer(false);
        await idle();
        assert.deepEqual(told(h), []);
    });

    test("starting the session again runs them again", async () => {
        const { asked, connect } = table([VPN.tcp]);
        const h = await begin([VPN], { connect });
        await until(() => asked.length === 1);
        await h.host.fire("session_start", { reason: "reload" }, h.ctx);
        await until(() => asked.length === 2);
    });
});

describe("/jig", () => {
    test("lists the checks with the last result of each", async () => {
        const { asked, connect } = table([VPN.tcp]);
        const h = await begin([VPN, ORDERS], { connect });
        await until(() => asked.length === 2);
        await until(() => told(h).length === 1);
        const status = await jigStatus(h);
        assert.match(
            status,
            /^Start checks \(one TCP connection each, made in the background when a session starts\):$/m,
        );
        assert.match(status, /^ {2}VPN \(vpn\.example\.com:443\): reachable$/m);
        assert.match(status, /^ {2}Orders API \(orders-api\.staging\.example\.com:8443\): not reachable$/m);
    });

    test("says not run for a check that has not run in this session", async () => {
        const { asked, connect } = table([]);
        const h = await begin([VPN], { connect, ui: false });
        await idle();
        assert.deepEqual(asked, []);
        assert.match(await jigStatus(h), /^ {2}VPN \(vpn\.example\.com:443\): not run$/m);
    });

    test("says not run until a check has answered", async () => {
        const { asked, connect } = manual();
        const h = await begin([VPN], { connect });
        await until(() => asked.length === 1);
        assert.match(await jigStatus(h), /^ {2}VPN \(vpn\.example\.com:443\): not run$/m);
        asked[0]?.answer(true);
        await idle();
        assert.match(await jigStatus(h), /^ {2}VPN \(vpn\.example\.com:443\): reachable$/m);
    });

    test("says nothing about checks when there are none", async () => {
        const h = await begin([], {});
        assert.doesNotMatch(await jigStatus(h), /Start checks/);
    });
});

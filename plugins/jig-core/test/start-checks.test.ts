// Start checks: what `startChecks` of jig.json accepts, and how the checks run when a session starts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { afterEach, beforeEach } from "node:test";
import { freePort } from "../src/kit/ports.ts";
import {
    CHECK_TIMEOUT_MS,
    createStartChecks,
    describeFailure,
    MAX_START_CHECKS,
    parseStartChecks,
    splitTcp,
    tcpConnect,
} from "../src/start-checks.ts";
import type { Connector, StartCheck } from "../src/start-checks.ts";
import { realTimers } from "../src/watch/timers.ts";
import { fakeClock } from "./support/clock.ts";

/** Parses a list and returns what was kept and what was said, as `key: message`. */
function parse(raw: unknown) {
    const said: string[] = [];
    const kept = parseStartChecks(raw, "startChecks", (key, message) => said.push(`${key}: ${message}`));
    return { kept, said };
}

describe("an address", () => {
    test("is a hostname or an IPv4 address and a port from 1 to 65535, or an IPv6 address in brackets and a port", () => {
        assert.deepEqual(splitTcp("vpn.example.com:443"), { host: "vpn.example.com", port: 443 });
        assert.deepEqual(splitTcp("localhost:1"), { host: "localhost", port: 1 });
        assert.deepEqual(splitTcp("10.0.0.5:65535"), { host: "10.0.0.5", port: 65535 });
        assert.deepEqual(splitTcp("[::1]:8080"), { host: "::1", port: 8080 });
        assert.deepEqual(splitTcp("[fe80::1]:22"), { host: "fe80::1", port: 22 });
        assert.deepEqual(splitTcp("a-b.c-d.example.com:80"), { host: "a-b.c-d.example.com", port: 80 });
    });

    test("anything else is refused: no port, a bad port, a bad host, an IPv6 address without brackets, a URL", () => {
        for (const text of [
            "",
            "vpn.example.com",
            "vpn.example.com:",
            ":443",
            "vpn.example.com:0",
            "vpn.example.com:65536",
            "vpn.example.com:044",
            "vpn.example.com:4 43",
            "vpn.example.com:-1",
            "vpn.example.com:99999999",
            "bad host.example.com:80",
            "-bad.example.com:80",
            "bad-.example.com:80",
            "bad..example.com:80",
            "example.com.:80",
            "under_score.example.com:80",
            "::1:8080",
            "[::1]",
            "[::1:80",
            "[10.0.0.1]:80",
            "[example.com]:80",
            "https://vpn.example.com:443",
            "vpn.example.com:443/path",
            "user@vpn.example.com:443",
            `${"a".repeat(64)}.example.com:80`,
            `${"a.".repeat(130)}com:80`,
            "vpn.example.com:443\n",
        ])
            assert.equal(splitTcp(text), undefined, JSON.stringify(text));
    });
});

describe("the list", () => {
    test("keeps a valid check, with its address split and the hint only when there is one", () => {
        const { kept, said } = parse([
            { name: "VPN", tcp: "vpn.example.com:443", hint: "connect your VPN client" },
            { name: "Staging", tcp: "[::1]:9", hint: "x" },
            { name: "Plain", tcp: "10.1.2.3:22" },
        ]);
        assert.deepEqual(said, []);
        assert.deepEqual(kept, [
            {
                name: "VPN",
                tcp: "vpn.example.com:443",
                host: "vpn.example.com",
                port: 443,
                hint: "connect your VPN client",
            },
            { name: "Staging", tcp: "[::1]:9", host: "::1", port: 9, hint: "x" },
            { name: "Plain", tcp: "10.1.2.3:22", host: "10.1.2.3", port: 22 },
        ]);
    });

    test("holds at most 16 checks", () => {
        const make = (count: number) =>
            Array.from({ length: count }, (_, n) => ({ name: `c${n}`, tcp: "h.example.com:1" }));
        assert.equal(parse(make(MAX_START_CHECKS)).kept.length, 16);
        assert.deepEqual(parse(make(MAX_START_CHECKS + 1)), {
            kept: [],
            said: ["startChecks: must hold at most 16 checks"],
        });
    });

    test("is a list of objects", () => {
        for (const raw of ["x", 1, true, null, {}, { name: "VPN", tcp: "h.example.com:1" }])
            assert.match(parse(raw).said.join("\n"), /^startChecks: must be a list of checks/, JSON.stringify(raw));
        for (const item of [null, "VPN", 3, [], [{ name: "VPN" }]])
            assert.deepEqual(parse([item]).said, [
                "startChecks[0]: must be an object with name, tcp and an optional hint",
            ]);
    });

    test("a name is 1 to 40 printable characters", () => {
        const nameKeys = (name: unknown) => parse([{ name, tcp: "h.example.com:1" }]).said;
        assert.deepEqual(nameKeys("A".repeat(40)), []);
        assert.deepEqual(nameKeys("VPN (office) 日本語 ✓"), []);
        for (const bad of [
            "",
            " ",
            "   ",
            "A".repeat(41),
            "two\nlines",
            "tab\there",
            "nul\u0000",
            "bidi‮override",
            "line sep",
            7,
            null,
            true,
            ["VPN"],
            {},
        ])
            assert.deepEqual(
                nameKeys(bad),
                ["startChecks[0].name: must be 1 to 40 printable characters"],
                JSON.stringify(bad),
            );
        assert.deepEqual(parse([{ tcp: "h.example.com:1" }]).said, ["startChecks[0].name: is required"]);
    });

    test("a hint is optional, and 1 to 200 printable characters", () => {
        const hintSays = (hint: unknown) => parse([{ name: "VPN", tcp: "h.example.com:1", hint }]).said;
        assert.deepEqual(hintSays("H".repeat(200)), []);
        for (const bad of ["", "  ", "H".repeat(201), "a\nb", 5, null, false])
            assert.deepEqual(
                hintSays(bad),
                ["startChecks[0].hint: must be 1 to 200 printable characters"],
                JSON.stringify(bad),
            );
    });

    test("an address that is missing or not host:port names the key", () => {
        assert.deepEqual(parse([{ name: "VPN" }]).said, ["startChecks[0].tcp: is required"]);
        for (const bad of ["vpn.example.com", "vpn.example.com:0", 443, null, ["h:1"]])
            assert.match(
                parse([{ name: "VPN", tcp: bad }]).said.join("\n"),
                /^startChecks\[0\]\.tcp: must be host:port/,
            );
    });

    test("an unknown field is an error, as elsewhere in the file", () => {
        assert.deepEqual(parse([{ name: "VPN", tcp: "h.example.com:1", url: "https://x" }]).said, [
            "startChecks[0].url: is not a known field",
        ]);
        assert.deepEqual(parse([{ name: "VPN", tcp: "h.example.com:1", Hint: "x" }]).said, [
            "startChecks[0].Hint: is not a known field",
        ]);
    });

    test("every wrong check is reported, with its position, and none is kept", () => {
        const { kept, said } = parse([
            { name: "ok", tcp: "h.example.com:1" },
            { name: "", tcp: "nope" },
            { name: "third" },
        ]);
        assert.deepEqual(said, [
            "startChecks[1].name: must be 1 to 40 printable characters",
            "startChecks[1].tcp: must be host:port: a hostname or IP address, a colon and a port from 1 to 65535 ([::1]:443 for IPv6)",
            "startChecks[2].tcp: is required",
        ]);
        assert.deepEqual(
            kept.map((check) => check.name),
            ["ok"],
        );
    });

    test("an error never repeats a long value, a secret-looking one or an unknown key at length", () => {
        const long = "x".repeat(5000);
        const secret = ["ghp", "A".repeat(36)].join("_");
        const messages = [
            ...parse([{ name: long, tcp: long, hint: long }]).said,
            ...parse([{ name: secret, tcp: secret, hint: 5 }]).said,
            ...parse([{ name: "VPN", tcp: "h.example.com:1", [long]: 1 }]).said,
        ].join("\n");
        assert.ok(!messages.includes("xxxxxxxxxxxx".repeat(8)), "no long value is echoed");
        assert.ok(!messages.includes("ghp_"), "no value is echoed");
        assert.ok(messages.length < 1200, `messages stay short (${messages.length})`);
    });
});

// ---- running -----------------------------------------------------------------------------------------------------------

const check = (name: string, tcp = "host.example.com:443", hint?: string): StartCheck => {
    const split = splitTcp(tcp);
    assert.ok(split, tcp);
    return { name, tcp, ...split, ...(hint === undefined ? {} : { hint }) };
};

describe("what a failed check says", () => {
    test("names the check and the address, and adds the hint when there is one", () => {
        assert.equal(
            describeFailure(check("VPN", "vpn.example.com:443")),
            "VPN is not reachable (vpn.example.com:443)",
        );
        assert.equal(
            describeFailure(check("VPN", "vpn.example.com:443", "connect your VPN client")),
            "VPN is not reachable (vpn.example.com:443): connect your VPN client",
        );
    });
});

describe("a real connection", () => {
    const servers: Server[] = [];
    const seen: Buffer[] = [];
    let closed = 0;
    beforeEach(() => {
        seen.length = 0;
        closed = 0;
    });
    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    });
    /** A local server that records what it is sent and when a connection ends. */
    async function listen(): Promise<number> {
        const server = createServer((socket) => {
            socket.on("data", (chunk) => seen.push(Buffer.from(chunk)));
            socket.on("close", () => closed++);
        });
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        return (server.address() as { port: number }).port;
    }
    const noSignal = new AbortController().signal;

    test("an open port is reachable, and the connection is closed without a byte sent", async () => {
        const port = await listen();
        assert.equal(await tcpConnect("127.0.0.1", port, noSignal), true);
        for (let n = 0; n < 100 && closed === 0; n++) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(closed, 1, "the server saw the connection end");
        assert.deepEqual(seen, [], "and nothing was sent on it");
    });

    test("a closed port is not reachable", async () => {
        assert.equal(await tcpConnect("127.0.0.1", await freePort(), noSignal), false);
    });

    test("an aborted signal ends it, before or during the connection", async () => {
        const early = new AbortController();
        early.abort();
        assert.equal(await tcpConnect("127.0.0.1", await listen(), early.signal), false);
        // Aborted in the same turn that the connection is begun: it never completes.
        const later = new AbortController();
        const pending = tcpConnect("127.0.0.1", await listen(), later.signal);
        later.abort();
        assert.equal(await pending, false);
    });

    test("the runner finds an open and a closed port, and reports only the closed one", async () => {
        const open = check("Open", `127.0.0.1:${await listen()}`);
        const shut = check("Shut", `127.0.0.1:${await freePort()}`, "start it");
        const checks = createStartChecks({ timers: realTimers });
        const failures: StartCheck[] = [];
        await checks.run([open, shut], (failed) => failures.push(failed), noSignal);
        assert.deepEqual(failures, [shut]);
        assert.deepEqual([checks.last(open), checks.last(shut)], ["reachable", "not reachable"]);
    });
});

describe("the runner", () => {
    /** A connector the test settles by hand, that remembers what it was asked. */
    function manual() {
        const asked: Array<{ host: string; port: number; signal: AbortSignal; settle: (reached: boolean) => void }> =
            [];
        const connector: Connector = (host, port, signal) =>
            new Promise<boolean>((resolve) => {
                asked.push({ host, port, signal, settle: resolve });
            });
        return { asked, connector };
    }

    test("the limit is three seconds", () => {
        assert.equal(CHECK_TIMEOUT_MS, 3000);
    });

    test("makes every connection at once, not one after another", async () => {
        const { asked, connector } = manual();
        const checks = createStartChecks({ connect: connector, timers: fakeClock().timers });
        const list = [check("A", "a.example.com:1"), check("B", "b.example.com:2"), check("C", "c.example.com:3")];
        const running = checks.run(list, () => undefined, new AbortController().signal);
        await fakeClock().settle();
        assert.deepEqual(
            asked.map((call) => `${call.host}:${call.port}`),
            ["a.example.com:1", "b.example.com:2", "c.example.com:3"],
            "all three were started before any was answered",
        );
        for (const call of asked) call.settle(true);
        await running;
    });

    test("a connection that never answers fails at three seconds, and its connection is told to stop", async () => {
        const clock = fakeClock();
        const { asked, connector } = manual();
        const checks = createStartChecks({ connect: connector, timers: clock.timers });
        const slow = check("Slow");
        const failures: string[] = [];
        let finished = false;
        const running = checks
            .run([slow], (failed) => failures.push(failed.name), new AbortController().signal)
            .then(() => {
                finished = true;
            });
        await clock.advance(CHECK_TIMEOUT_MS - 1);
        assert.deepEqual([finished, failures, checks.last(slow)], [false, [], "not run"]);
        assert.equal(asked[0]?.signal.aborted, false);
        await clock.advance(1);
        await running;
        assert.deepEqual([failures, checks.last(slow)], [["Slow"], "not reachable"]);
        assert.equal(asked[0]?.signal.aborted, true, "the connector was told to give up");
        assert.equal(clock.pending(), 0, "no timer is left running");
    });

    test("an answer in time stops the timer, and a late answer changes nothing", async () => {
        const clock = fakeClock();
        const { asked, connector } = manual();
        const checks = createStartChecks({ connect: connector, timers: clock.timers });
        const quick = check("Quick");
        const running = checks.run([quick], () => assert.fail("it connected"), new AbortController().signal);
        await clock.settle();
        asked[0]?.settle(true);
        await running;
        assert.equal(checks.last(quick), "reachable");
        assert.equal(clock.pending(), 0);
    });

    test("makes one attempt per check, and no retry", async () => {
        const clock = fakeClock();
        let attempts = 0;
        const checks = createStartChecks({
            connect: async () => {
                attempts++;
                return false;
            },
            timers: clock.timers,
        });
        await checks.run([check("A"), check("B")], () => undefined, new AbortController().signal);
        await clock.advance(60_000);
        assert.equal(attempts, 2);
    });

    test("a connector that throws, rejects or answers oddly counts as not reachable", async () => {
        const clock = fakeClock();
        const failures: string[] = [];
        const kinds: Connector[] = [
            () => {
                throw new Error("boom");
            },
            async () => {
                throw new Error("boom");
            },
            async () => "yes" as unknown as boolean,
        ];
        for (const [n, connector] of kinds.entries()) {
            const checks = createStartChecks({ connect: connector, timers: clock.timers });
            await checks.run([check(`K${n}`)], (failed) => failures.push(failed.name), new AbortController().signal);
        }
        assert.deepEqual(failures, ["K0", "K1", "K2"]);
    });

    test("reports each failure as it is known, and a failure to report does not stop the others", async () => {
        const clock = fakeClock();
        const { asked, connector } = manual();
        const checks = createStartChecks({ connect: connector, timers: clock.timers });
        const told: string[] = [];
        const running = checks.run(
            [check("A"), check("B"), check("C")],
            (failed) => {
                told.push(failed.name);
                if (failed.name === "A") throw new Error("the screen is gone");
            },
            new AbortController().signal,
        );
        await clock.settle();
        asked[1]?.settle(false);
        await clock.settle();
        assert.deepEqual(told, ["B"], "B is told before the others have answered");
        asked[0]?.settle(false);
        asked[2]?.settle(false);
        await running;
        assert.deepEqual(told, ["B", "A", "C"]);
    });

    test("remembers the last result of each check, and a new run starts from not run", async () => {
        const clock = fakeClock();
        const answers = new Map([["up.example.com", true]]);
        const { asked, connector } = manual();
        const checks = createStartChecks({ connect: connector, timers: clock.timers });
        const up = check("Up", "up.example.com:1");
        const down = check("Down", "down.example.com:1");
        assert.deepEqual([checks.last(up), checks.last(down)], ["not run", "not run"]);
        const first = checks.run([up, down], () => undefined, new AbortController().signal);
        await clock.settle();
        for (const call of asked) call.settle(answers.get(call.host) === true);
        await first;
        assert.deepEqual([checks.last(up), checks.last(down)], ["reachable", "not reachable"]);
        const again = checks.run([up, down], () => undefined, new AbortController().signal);
        await clock.settle();
        assert.deepEqual([checks.last(up), checks.last(down)], ["not run", "not run"]);
        for (const call of asked.slice(2)) call.settle(true);
        await again;
        assert.deepEqual([checks.last(up), checks.last(down)], ["reachable", "reachable"]);
    });

    test("when the session ends it stops without a word and records nothing", async () => {
        const clock = fakeClock();
        const { asked, connector } = manual();
        const checks = createStartChecks({ connect: connector, timers: clock.timers });
        const session = new AbortController();
        const a = check("A");
        const running = checks.run([a], () => assert.fail("nobody is there to tell"), session.signal);
        await clock.settle();
        session.abort();
        await running;
        assert.equal(asked[0]?.signal.aborted, true);
        assert.equal(checks.last(a), "not run");
        assert.equal(clock.pending(), 0);
    });
});

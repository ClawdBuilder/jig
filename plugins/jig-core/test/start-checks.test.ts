// Start checks: what `startChecks` of jig.json accepts, and how the checks run when a session starts.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MAX_START_CHECKS, parseStartChecks, splitTcp } from "../src/start-checks.ts";

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

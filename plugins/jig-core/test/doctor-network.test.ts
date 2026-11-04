// The network part of `/jig doctor`: hosts from startChecks and the sections, one connection each, the release cache,
// and the rule that none of it runs without `--network`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { defaultConfig, emptyAdditions } from "../src/config.ts";
import type { DoctorContext, DoctorOptions } from "../src/doctor.ts";
import {
    collectHosts,
    networkChecks,
    readReleaseCache,
    releaseCacheFile,
    releaseLine,
    writeReleaseCache,
} from "../src/doctor-network.ts";

let home: string;
let agentDir: string;
let stateDir: string;
let now: Date;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-network-"));
    agentDir = path.join(home, "agent");
    stateDir = path.join(home, "state");
    mkdirSync(agentDir);
    mkdirSync(stateDir);
    now = new Date("2026-11-04T12:00:00.000Z");
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

function context(overrides: Partial<DoctorContext> = {}): DoctorContext {
    return {
        env: { PATH: "" },
        personal: {
            file: path.join(agentDir, "jig.json"),
            found: true,
            config: defaultConfig(),
            problems: [],
            sections: new Map(),
            incomplete: new Map(),
            invalid: new Set(),
        },
        sectionChecks: new Map(),
        company: emptyAdditions(),
        sections: new Map(),
        commands: {},
        protectedPaths: () => [],
        sandbox: undefined,
        recordsProblem: undefined,
        agentDir,
        configPath: path.join(agentDir, "jig.json"),
        stateDir,
        workingDir: home,
        secrets: { passStoreDir: () => path.join(home, "pass") },
        now: () => now,
        ...overrides,
    };
}

function options(overrides: Partial<DoctorOptions> = {}): DoctorOptions {
    return {
        network: true,
        platform: "linux",
        jigVersion: "0.3.0",
        jigRepository: "git+https://github.com/example/jig.git",
        home,
        fetchText: async () => ({ status: 200, text: '{"tag_name":"v0.3.0"}' }),
        ...overrides,
    };
}

describe("collectHosts", () => {
    test("reads startChecks first and addresses in sections, each host and port once", () => {
        const personal = {
            ...context().personal,
            config: {
                ...defaultConfig(),
                startChecks: [{ name: "VPN", tcp: "vpn.example.com:443", host: "vpn.example.com", port: 443 }],
            },
        };
        const ctx = context({
            personal,
            sections: new Map([
                ["api", { url: "https://api.staging.example.com/v1" }],
                ["api again", { url: "https://api.staging.example.com/v2" }],
                ["db", { tcp: "orders-db.example.com:5432" }],
                ["secret", { token: "op://Work/Orders/token" }],
                ["clock", { opens: "12:30" }],
            ]),
        });
        const { hosts, dropped } = collectHosts(ctx);
        assert.equal(dropped, 0);
        assert.deepEqual(
            hosts.map((host) => host.tcp),
            ["vpn.example.com:443", "api.staging.example.com:443", "orders-db.example.com:5432"],
        );
        assert.equal(hosts[0]?.origin, "startChecks");
        assert.equal(hosts[1]?.origin, "sections");
    });

    test("caps the list and says how many were left out", () => {
        const startChecks = Array.from({ length: 20 }, (_, index) => ({
            name: `host${index}`,
            tcp: `host${index}.example.com:443`,
            host: `host${index}.example.com`,
            port: 443,
        }));
        const ctx = context({
            personal: { ...context().personal, config: { ...defaultConfig(), startChecks } },
        });
        assert.equal(collectHosts(ctx).hosts.length, 16);
        assert.equal(collectHosts(ctx).dropped, 4);
    });

    test("keeps an IPv6 address in brackets", () => {
        const ctx = context({ sections: new Map([["local", { url: "https://[::1]:8443/health" }]]) });
        assert.deepEqual(collectHosts(ctx).hosts[0], {
            name: "::1",
            tcp: "[::1]:8443",
            host: "::1",
            port: 8443,
            origin: "sections",
        });
    });
});

describe("networkChecks", () => {
    test("is off without --network: one skip, and nothing is contacted", async () => {
        let contacted = false;
        const lines = await networkChecks(context(), {
            ...options(),
            network: false,
            connect: async () => {
                contacted = true;
                return true;
            },
        });
        assert.equal(lines.length, 1);
        assert.equal(lines[0]?.id, "network.off");
        assert.equal(lines[0]?.level, "skip");
        assert.equal(contacted, false);
    });

    test("connects once to each host, in parallel, and reports reachable and not", async () => {
        const personal = {
            ...context().personal,
            config: {
                ...defaultConfig(),
                startChecks: [
                    {
                        name: "VPN",
                        tcp: "vpn.example.com:443",
                        host: "vpn.example.com",
                        port: 443,
                        hint: "connect your VPN client",
                    },
                ],
            },
        };
        const seen: string[] = [];
        const lines = await networkChecks(
            context({
                personal,
                sections: new Map([
                    ["api", { url: "https://api.staging.example.com/v1" }],
                    ["db", { tcp: "orders-db.example.com:5432" }],
                ]),
            }),
            options({
                connect: async (host) => {
                    seen.push(host);
                    return host !== "vpn.example.com";
                },
            }),
        );
        assert.deepEqual(seen.sort(), ["api.staging.example.com", "orders-db.example.com", "vpn.example.com"]);
        const vpn = lines.find((line) => line.title === "VPN");
        assert.equal(vpn?.level, "warn");
        assert.equal(vpn?.fix, "connect your VPN client");
        assert.deepEqual(vpn?.data, { host: "vpn.example.com", port: 443 });
        assert.equal(lines.find((line) => line.title === "api.staging.example.com")?.level, "ok");
        assert.equal(lines.find((line) => line.title === "orders-db.example.com")?.level, "ok");
        assert.equal(lines.find((line) => line.id === "network.release")?.level, "ok");
    });

    test("with no hosts it says so, and still checks the release", async () => {
        const lines = await networkChecks(context(), options());
        assert.equal(lines[0]?.id, "network.hosts");
        assert.equal(lines[0]?.level, "skip");
        assert.equal(lines[1]?.id, "network.release");
    });
});

describe("the latest release", () => {
    test("warns when a newer release is out, and caches the answer", async () => {
        let calls = 0;
        const line = await releaseLine(
            context(),
            options({
                fetchText: async () => {
                    calls++;
                    return { status: 200, text: '{"tag_name":"v9.9.9"}' };
                },
            }),
        );
        assert.equal(line.level, "warn");
        assert.equal(line.detail, "A newer release is out: 9.9.9 (you have 0.3.0).");
        assert.equal(line.fix, "Update Jig: pi update.");
        assert.deepEqual(line.data, { latest: "9.9.9", current: "0.3.0" });
        assert.equal(calls, 1);
        assert.equal(
            readReleaseCache(stateDir, "https://api.github.com/repos/example/jig/releases/latest", now),
            "9.9.9",
        );
        if (process.platform !== "win32") assert.equal(statSync(releaseCacheFile(stateDir)).mode & 0o777, 0o600);
    });

    test("uses the cache for a day, and asks again after that", async () => {
        let calls = 0;
        const tags = ["0.4.0", "0.3.0"];
        const fetchText = async (): Promise<{ status: number; text: string }> => {
            calls++;
            return { status: 200, text: `{"tag_name":"v${tags[Math.min(calls - 1, tags.length - 1)]}"}` };
        };
        await releaseLine(context(), options({ fetchText }));
        assert.equal(calls, 1);

        const cached = await releaseLine(
            context(),
            options({
                fetchText: async () => {
                    throw new Error("the network is down");
                },
            }),
        );
        assert.equal(cached.level, "warn");
        assert.equal(cached.detail, "A newer release is out: 0.4.0 (you have 0.3.0).");
        assert.equal(calls, 1, "a fresh cache is used without a request");

        now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
        const stale = await releaseLine(context(), options({ fetchText }));
        assert.equal(stale.level, "ok");
        assert.equal(stale.detail, "You have 0.3.0; the latest release is 0.3.0.");
        assert.equal(calls, 2, "a stale cache is replaced");
    });

    test("a failure is a skip, not a failure, and writes no cache", async () => {
        const line = await releaseLine(
            context(),
            options({
                fetchText: async () => {
                    throw new Error("offline");
                },
            }),
        );
        assert.equal(line.level, "skip");
        assert.match(line.detail ?? "", /could not be reached/);
        assert.equal(
            readReleaseCache(stateDir, "https://api.github.com/repos/example/jig/releases/latest", now),
            undefined,
        );
    });

    test("skips a package with no repository, a repository that is not GitHub, and an unknown version", async () => {
        let calls = 0;
        const fetchText = async (): Promise<{ status: number; text: string }> => {
            calls++;
            return { status: 200, text: '{"tag_name":"v0.4.0"}' };
        };
        const noRepo = await releaseLine(context(), options({ jigRepository: "", fetchText }));
        assert.equal(noRepo.level, "skip");
        assert.match(noRepo.detail ?? "", /does not say where/);
        const elsewhere = await releaseLine(
            context(),
            options({ jigRepository: "git+https://git.example.com/team/jig.git", fetchText }),
        );
        assert.equal(elsewhere.level, "skip");
        assert.match(elsewhere.detail ?? "", /only checked for a GitHub/);
        const unknown = await releaseLine(context(), options({ jigVersion: null, fetchText }));
        assert.equal(unknown.level, "skip");
        assert.equal(calls, 0);
    });

    test("a non-200 answer and a page without a version are skips", async () => {
        const notFound = await releaseLine(context(), options({ fetchText: async () => ({ status: 404, text: "" }) }));
        assert.equal(notFound.level, "skip");
        assert.match(notFound.detail ?? "", /HTTP 404/);
        const noTag = await releaseLine(context(), options({ fetchText: async () => ({ status: 200, text: "{}" }) }));
        assert.equal(noTag.level, "skip");
        assert.match(noTag.detail ?? "", /did not name a version/);
    });

    test("the cache is keyed to the URL and expires at the day, not before", () => {
        const url = "https://api.github.com/repos/example/jig/releases/latest";
        writeReleaseCache(stateDir, url, "1.2.3", now);
        assert.equal(readReleaseCache(stateDir, url, new Date(now.getTime() + 24 * 60 * 60 * 1000)), "1.2.3");
        assert.equal(readReleaseCache(stateDir, url, new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1)), undefined);
        assert.equal(readReleaseCache(stateDir, `${url}/other`, now), undefined);
        writeFileSync(
            releaseCacheFile(stateDir),
            JSON.stringify({ schema: 2, url, checkedAt: now.toISOString(), latest: "1.2.3" }),
        );
        assert.equal(readReleaseCache(stateDir, url, now), undefined);
    });
});

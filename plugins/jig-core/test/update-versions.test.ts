// Choosing the version `jig update` moves to: newest stable, `--to`, and the company's range cap.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRange, selectTarget, stableVersions } from "../src/update-versions.ts";

const registry = {
    versions: {
        "0.3.0": {},
        "0.4.0": {},
        "0.4.1": {},
        "0.4.2": {},
        "0.5.0": {},
        "0.6.0-beta.1": {},
        "0.6.0": {},
    },
};

describe("stableVersions", () => {
    test("is every stable release, highest first, never a prerelease", () => {
        assert.deepEqual(stableVersions(registry), ["0.6.0", "0.5.0", "0.4.2", "0.4.1", "0.4.0", "0.3.0"]);
    });
});

describe("parseRange", () => {
    test("reads comparator sets, exact versions, caret and tilde", () => {
        const inside = parseRange(">=0.4.1 <0.5.0");
        assert.ok(inside);
        assert.equal(inside("0.4.1"), true);
        assert.equal(inside("0.4.9"), true);
        assert.equal(inside("0.5.0"), false);
        assert.equal(parseRange("0.4.1")?.("0.4.1"), true);
        assert.equal(parseRange("^0.4.1")?.("0.4.9"), true);
        assert.equal(parseRange("^0.4.1")?.("0.5.0"), false);
        assert.equal(parseRange("~0.4.1")?.("0.4.9"), true);
        assert.equal(parseRange("~0.4.1")?.("0.5.0"), false);
    });

    test("refuses syntax it does not read instead of guessing", () => {
        for (const range of ["latest", "0.4.x", ">=0.4.1 || next", ""]) {
            if (range === "") assert.ok(parseRange(range));
            else assert.equal(parseRange(range), undefined, range);
        }
    });
});

describe("selectTarget", () => {
    test("takes the newest stable release when no company caps it", () => {
        const chosen = selectTarget(registry, []);
        assert.ok("target" in chosen);
        assert.equal(chosen.target.version, "0.6.0");
        assert.equal(chosen.target.newest, "0.6.0");
        assert.deepEqual(chosen.target.cappedBy, []);
    });

    test("stops at the highest release inside every company range, and says who capped it", () => {
        const chosen = selectTarget(registry, [
            { package: "acme-jig", range: ">=0.4.1 <0.5.0" },
            { package: "other-jig", range: ">=0.4.0" },
        ]);
        assert.ok("target" in chosen);
        assert.equal(chosen.target.version, "0.4.2");
        assert.deepEqual(chosen.target.cappedBy, [{ package: "acme-jig", range: ">=0.4.1 <0.5.0" }]);
    });

    test("honours --to only when it is published, stable and inside the ranges", () => {
        const chosen = selectTarget(registry, [{ package: "acme-jig", range: ">=0.4.1 <0.5.0" }], "0.4.1");
        assert.ok("target" in chosen);
        assert.equal(chosen.target.version, "0.4.1");
        assert.match((selectTarget(registry, [], "9.9.9") as { problem: string }).problem, /not published/);
        assert.match((selectTarget(registry, [], "0.6.0-beta.1") as { problem: string }).problem, /stable/);
        assert.match(
            (selectTarget(registry, [{ package: "acme-jig", range: ">=0.4.1 <0.5.0" }], "0.6.0") as { problem: string })
                .problem,
            /outside the company range/,
        );
    });

    test("refuses a range it cannot read", () => {
        const chosen = selectTarget(registry, [{ package: "acme-jig", range: "latest" }]);
        assert.ok("problem" in chosen);
        assert.match(chosen.problem, /acme-jig states a Jig range this cannot read: latest/);
    });
});

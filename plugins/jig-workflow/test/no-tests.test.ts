import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { noTestsRan, reportWritten, setupLines } from "../src/tests.ts";

test("a report written by this run means a real failure, whatever the output says", () => {
    const root = path.join(tmpdir(), `jig-reports-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(root, "build/test-results/test"), { recursive: true });
    const report = path.join(root, "build/test-results/test/TEST-x.xml");
    writeFileSync(report, "<testsuite/>");
    const started = Date.now();
    utimesSync(report, new Date(started + 10), new Date(started + 10));
    assert.equal(reportWritten(root, started), true);
    assert.equal(noTestsRan("FAILURE: Build failed\nCould not compile", 1, false, true), false);
});

test("a stale report is not this run's, so a compile failure has no report", () => {
    const root = path.join(tmpdir(), `jig-stale-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(root, "target/surefire-reports"), { recursive: true });
    const report = path.join(root, "target/surefire-reports/TEST-old.xml");
    writeFileSync(report, "<testsuite/>");
    const started = Date.now();
    utimesSync(report, new Date(started - 60_000), new Date(started - 60_000));
    assert.equal(reportWritten(root, started), false);
    assert.equal(noTestsRan("error: cannot find symbol", 1, false, false), true);
});

test("generic failures, timeouts and empty output are not called setup", () => {
    assert.equal(noTestsRan("3 failed, 2 passed", 1, false, false), false);
    assert.equal(noTestsRan("", 1, true, false), false);
    assert.equal(noTestsRan("", 1, false, false), false);
    assert.equal(noTestsRan("FAILURE: Build failed", 0, false, false), false);
});

test("setup lines come from the whole output", () => {
    assert.deepEqual(setupLines("noise\nCould not compile build file\nmore"), ["Could not compile build file"]);
});

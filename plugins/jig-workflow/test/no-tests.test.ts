import assert from "node:assert/strict";
import { test } from "node:test";
import { noTestsRan, setupLines } from "../src/tests.ts";

test("a setup failure is not a failing test", () => {
    const compile = "FAILURE: Build failed with an exception.\nWhat went wrong:\nCould not compile build file";
    assert.equal(noTestsRan(compile, 1, false), true);
    assert.deepEqual(setupLines(compile), [
        "FAILURE: Build failed with an exception.",
        "What went wrong:",
        "Could not compile build file",
    ]);
    const failing = "Test > orders > fails FAILED\nThere were failing tests";
    assert.equal(noTestsRan(failing, 1, false), false);
    assert.equal(noTestsRan("", 0, false), false);
    assert.equal(noTestsRan(compile, 1, true), false);
});

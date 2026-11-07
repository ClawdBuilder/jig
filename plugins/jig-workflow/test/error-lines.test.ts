import assert from "node:assert/strict";
import { test } from "node:test";
import { errorLines } from "../src/tests.ts";

const cases: Array<[string, string, string]> = [
    [
        "Gradle",
        "FAILURE: Build failed.\n* What went wrong:\nCould not compile build file",
        "Could not compile build file",
    ],
    ["Maven", "[ERROR] COMPILATION ERROR :\n[ERROR] cannot find symbol", "cannot find symbol"],
    ["npm", "npm ERR! code ELIFECYCLE\nError: expect(received).toBe", "expect(received).toBe"],
    ["go", "--- FAIL: TestX\n    x_test.go:5: not found", "not found"],
    ["pytest", "E   assert 1 == 2\nE   AssertionError", "AssertionError"],
];

for (const [name, output, expected] of cases) {
    test(`${name}: the useful line is found in the whole output`, () => {
        const lines = errorLines(output);
        assert.ok(
            lines.some((line) => line.includes(expected)),
            lines.join(" | "),
        );
    });
}

test("a useful error line outside the last 60 lines is found", () => {
    const output = ["error: cannot find symbol", ...Array.from({ length: 80 }, (_, i) => `noise ${i}`)].join("\n");
    assert.deepEqual(errorLines(output), ["error: cannot find symbol"]);
});

test("error lines are bounded and empty output gives none", () => {
    assert.equal(errorLines("error: " + "x".repeat(2000))[0]?.length, 500);
    assert.deepEqual(errorLines(""), []);
});

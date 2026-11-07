import assert from "node:assert/strict";
import { test } from "node:test";
import { clampHoldAbortAfter, parseReviewSettings, validateReviewSection } from "../src/settings.ts";

test("the abort threshold is clamped on load and on the settings page", () => {
    assert.equal(clampHoldAbortAfter(0), 2);
    assert.equal(clampHoldAbortAfter(99), 2);
    assert.equal(clampHoldAbortAfter("3"), 2);
    assert.equal(clampHoldAbortAfter(3), 3);
    assert.equal(parseReviewSettings({ holdAbortAfter: 0 }).holdAbortAfter, 2);
});

test("the review section rejects an unknown field and an out-of-range threshold", () => {
    assert.deepEqual(validateReviewSection({ holdAgent: false, holdAbortAfter: 4 }), []);
    assert.match(validateReviewSection({ nope: true })[0] ?? "", /unknown field/);
    assert.match(validateReviewSection({ holdAbortAfter: 0 })[0] ?? "", /whole number from 1 to 10/);
});

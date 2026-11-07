// The model cannot act on a bare AbortError: a time budget says how long it waited and what to narrow.
import assert from "node:assert/strict";
import { test } from "node:test";
import { elasticsearch } from "../src/backends/elasticsearch.ts";
import { nextStep } from "../src/failure.ts";

test("the time-budget line names the limit and the two ways to narrow", () => {
    const text = nextStep("time_budget", elasticsearch);
    assert.match(text, /80 s limit/);
    assert.match(text, /narrow the window or the environment/);
    assert.doesNotMatch(text, /AbortError|operation was aborted/i);
});

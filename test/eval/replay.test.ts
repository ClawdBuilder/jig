// The eval task corpus and the replay runner. No model is called: these check the data, the scorer and the one task that
// exercises a real jig-core gate. The model-dependent tasks are marked and wait for the live runner.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fromCalls, replayHarness, replayable, safetyPassed, scorePolicy } from "./replay.ts";
import type { Task } from "./replay.ts";

const tasks = (JSON.parse(readFileSync(path.join(import.meta.dirname, "tasks.json"), "utf8")) as { tasks: Task[] })
    .tasks;
const safety = tasks.filter((task) => task.safety);

test("fifteen tasks, the five safety starts, and a unique id for each", () => {
    assert.equal(tasks.length, 15);
    assert.deepEqual(
        safety.map((task) => task.source).sort((a, b) => a - b),
        [7, 9, 11, 12, 14],
    );
    assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
    for (const task of tasks) {
        assert.ok(task.title.length > 0);
        assert.ok(task.calls.length > 0);
        assert.ok(task.checks.required.length + task.checks.forbidden.length >= 0);
    }
});

test("a required call and a forbidden call both fail the policy score", () => {
    const task = tasks.find((one) => one.id === "jira-read") as Task;
    assert.equal(scorePolicy(task, fromCalls(task)), 3);
    assert.equal(
        scorePolicy(task, [{ tool: "logs", decision: "allow", ran: true }]),
        0,
        "the required jira call is absent",
    );
    assert.equal(
        scorePolicy(task, [
            { tool: "jira", decision: "allow", ran: true },
            { tool: "jira update", decision: "allow", ran: true },
        ]),
        0,
        "the forbidden write ran",
    );
});

test("a safety task fails when its denied call ran", () => {
    const task = tasks.find((one) => one.id === "production-write") as Task;
    assert.equal(safetyPassed(task, fromCalls(task)), true);
    assert.equal(safetyPassed(task, [{ tool: "prod_write_tool", decision: "allow", ran: true }]), false);
});

test("the production write task runs through the real jig-core gate and is blocked", async () => {
    const task = tasks.find((one) => one.id === "production-write") as Task;
    const result = await replayHarness(task);
    assert.equal(result.observed[0]?.decision, "blocked");
    assert.equal(result.observed[0]?.ran, false);
    assert.equal(result.policy, 3);
    assert.equal(result.safety, true);
});

test("the rest of the corpus is marked for the live model, not silently replayed", () => {
    assert.deepEqual(
        replayable(tasks).map((task) => task.id),
        ["production-write"],
    );
    for (const task of tasks) {
        if (task.modelOnly) assert.match(task.prompt, /\S/);
    }
});

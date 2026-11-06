// What `jig update` would do, before it changes anything: the target, the Pi question, the two copies and the company cap.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { describePlan, movablePiSource, planUpdate, statedRequirement } from "../src/update-plan.ts";
import type { UpdatePlanInput } from "../src/update-plan.ts";
import type { SelectedTarget } from "../src/update-versions.ts";

function target(version = "0.5.0", minimum = "1.4.0", tested = "1.5.0"): SelectedTarget {
    return {
        version,
        release: { jig: { agents: { pi: { minimum, tested } } } },
        newest: "0.5.0",
        cappedBy: [],
    };
}

function input(overrides: Partial<UpdatePlanInput> = {}): UpdatePlanInput {
    return {
        name: "@clawdbuilder/jig",
        current: "0.4.1",
        target: target(),
        piVersion: "1.5.0",
        piCopy: { version: "0.4.1", source: "npm:@clawdbuilder/jig", scope: "user", folder: "/tmp/jig" },
        globalVersion: "0.4.1",
        ...overrides,
    };
}

describe("planUpdate", () => {
    test("plans both copies, no Pi change when Pi is in range", () => {
        const built = planUpdate(input());
        assert.ok("plan" in built);
        assert.equal(built.plan.pi, undefined);
        assert.equal(built.plan.piCopy?.needed, true);
        assert.equal(built.plan.global?.needed, true);
        assert.equal(built.plan.changes, true);
    });

    test("asks for the tested Pi when the installed one is below the minimum", () => {
        const built = planUpdate(input({ piVersion: "1.3.0", target: target("0.5.0", "1.4.0", "1.5.0") }));
        assert.ok("plan" in built);
        assert.deepEqual(built.plan.pi, { from: "1.3.0", to: "1.5.0" });
        assert.match(describePlan(built.plan).join("\n"), /Pi 1\.3\.0 -> 1\.5\.0/);
    });

    test("warns about a Pi newer than tested, and still plans", () => {
        const built = planUpdate(input({ piVersion: "1.6.0" }));
        assert.ok("plan" in built);
        assert.equal(built.plan.pi, undefined);
        assert.match(built.plan.piNotes.join(" "), /newer than 1\.5\.0/);
    });

    test("refuses a release that does not state its Pi versions", () => {
        const broken = target();
        broken.release = {};
        const built = planUpdate(input({ target: broken }));
        assert.ok("problem" in built);
        assert.match(built.problem, /does not say which Pi/);
        assert.equal(statedRequirement(broken), undefined);
    });

    test("refuses a missing or project-scoped Pi copy and a git copy; a pin naming Jig is movable and shown", () => {
        const missing = planUpdate(input({ piCopy: undefined }));
        assert.ok("problem" in missing);
        assert.match(missing.problem, /not installed in Pi/);

        const project = planUpdate(input({ piCopy: { ...input().piCopy, scope: "project" } }));
        assert.ok("problem" in project);
        assert.match(project.problem, /project packages/);

        const git = planUpdate(input({ piCopy: { ...input().piCopy, source: "git:github.com/example/jig" } }));
        assert.ok("problem" in git);
        assert.match(git.problem, /not a plain npm source/);

        const pinned = planUpdate(input({ piCopy: { ...input().piCopy, source: "npm:@clawdbuilder/jig@0.4.1" } }));
        assert.ok("plan" in pinned);
        assert.equal(pinned.plan.piCopy?.pinned, true);
        assert.equal(pinned.plan.piCopy?.needed, true);
        assert.match(describePlan(pinned.plan).join("\n"), /pinned to 0\.4\.1; moving it to 0\.5\.0/);
    });

    test("says when both copies are already on the target", () => {
        const built = planUpdate(input({ piCopy: { ...input().piCopy, version: "0.5.0" }, globalVersion: "0.5.0" }));
        assert.ok("plan" in built);
        assert.equal(built.plan.changes, false);
        assert.match(built.plan.warnings.join(" "), /already/);
    });

    test("reads a movable npm source, and one pinned by @version", () => {
        assert.deepEqual(movablePiSource("npm:@clawdbuilder/jig", "@clawdbuilder/jig"), {});
        assert.deepEqual(movablePiSource("npm:@clawdbuilder/jig@0.4.1", "@clawdbuilder/jig"), { version: "0.4.1" });
        assert.equal(movablePiSource("git:github.com/example/jig", "@clawdbuilder/jig"), undefined);
        assert.equal(movablePiSource("npm:other", "@clawdbuilder/jig"), undefined);
    });
});

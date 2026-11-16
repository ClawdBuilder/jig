// The fixed probes setup may use for proposed defaults, and the register-time check that names one of them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { detectedLine, detectValue } from "../src/detect.ts";
import { checkOnboarding } from "../src/onboarding.ts";

/** A stand-in for one fixed command: answers every call with `answer` and records the calls it saw. */
function probe(answer: string | undefined): {
    calls: string[];
    run: (program: string, args: readonly string[]) => string | undefined;
} {
    const calls: string[] = [];
    return {
        calls,
        run: (program, args) => {
            calls.push([program, ...args].join(" "));
            return answer;
        },
    };
}

test("each probe reads its own source", () => {
    const email = probe("jane.doe@example.com");
    assert.equal(detectValue("git-email", {}, email.run), "jane.doe");
    assert.deepEqual(email.calls, ["git config --get user.email"]);

    const account = probe("github.com\n  ✓ Logged in to github.com account acme-work (keyring)");
    assert.equal(detectValue("gh-account", {}, account.run), "acme-work");
    assert.deepEqual(account.calls, ["gh auth status"]);

    const profile = probe("default\nstaging\n");
    assert.equal(detectValue("aws-profile", {}, profile.run), "default");
    assert.deepEqual(profile.calls, ["aws configure list-profiles"]);

    assert.equal(detectValue("user", { USER: "jdoe" }), "jdoe");
    assert.equal(detectValue("user", { USERNAME: "jdoe" }), "jdoe");
});

test("a probe that fails or finds nothing has no default", () => {
    assert.equal(detectValue("git-email", {}, probe(undefined).run), undefined);
    assert.equal(detectValue("git-email", {}, probe("jdoe").run), "jdoe");
    assert.equal(detectValue("gh-account", {}, probe("not logged in").run), undefined);
    assert.equal(detectValue("aws-profile", {}, probe("\n").run), undefined);
    assert.equal(detectValue("user", { USER: " " }), undefined);
    assert.equal(detectValue("user", {}), undefined);
});

test("an unknown probe is refused when the company registers", () => {
    const text = { kind: "text", section: "acme", path: "bastion.user", label: "Login", detect: "password" };
    assert.throws(
        () => checkOnboarding({ items: [text] }),
        /detect: must be one of user, git-email, gh-account, aws-profile/,
    );
    const pick = {
        kind: "pick",
        section: "acme",
        path: "team",
        label: "Team",
        choices: ["orders"],
        detect: "password",
    };
    assert.throws(() => checkOnboarding({ items: [pick] }), /detect: must be one of/);
});

test("a probe and an optional answer do not combine", () => {
    const item = {
        kind: "text",
        section: "acme",
        path: "bastion.user",
        label: "Login",
        optional: true,
        detect: "user",
    };
    assert.throws(() => checkOnboarding({ items: [item] }), /detect: cannot be used with optional/);
    const pick = {
        kind: "pick",
        section: "acme",
        path: "team",
        label: "Team",
        choices: ["orders"],
        detect: "user",
    };
    const checked = checkOnboarding({ items: [pick] });
    assert.equal(checked.items[0]?.kind, "pick");
});

test("the found line says it is a proposal", () => {
    assert.equal(detectedLine("jdoe"), "Found on this machine: jdoe");
});

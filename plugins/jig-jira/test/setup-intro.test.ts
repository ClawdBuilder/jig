// The line setup says before Jira's questions must be true of every way to sign in setup offers, the session relay too.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LOGS_SETUP } from "../../jig-logs/src/onboarding.ts";
import { JIRA_METHODS } from "../src/index.ts";
import { JIRA_SETUP } from "../src/onboarding.ts";

/** The sentences setup shows before a plugin's questions. */
function intro(setup: typeof JIRA_SETUP): string[] {
    return (setup.items ?? []).flatMap((item) => (item.kind === "info" ? [item.detail ?? ""] : []));
}

describe("the line before Jira's questions", () => {
    test("says Jig never signs in, and covers both a token from a store and a session relay", () => {
        assert.ok(
            JIRA_METHODS.some((method) => method.id === "transport"),
            "Jira offers a sign-in through a relay",
        );
        const lines = intro(JIRA_SETUP);
        assert.equal(lines.length, 1, lines.join("\n"));
        const line = lines[0] ?? "";
        assert.match(line, /never signs in for you/);
        assert.match(line, /token from a store you choose/);
        assert.match(line, /session relay that holds your sign-in/);
    });

    test("a line of logs' setup about tokens would have to name the relay too (it has none now)", () => {
        for (const line of intro(LOGS_SETUP)) {
            if (/token|credential/i.test(line)) assert.match(line, /relay/i, line);
        }
    });
});

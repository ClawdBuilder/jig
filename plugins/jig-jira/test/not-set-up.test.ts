// A call with no valid `jira` section is refused with a line the model repeats: it names the command that sets Jira up
// first, and the by-hand route second.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setupHarness } from "./support/harness.ts";

const h = await setupHarness();
after(() => h.close());

test("without a jira section the tool names the setup command, then the by-hand route", async () => {
    h.reset();
    h.jig.setSection("jira", undefined);
    const result = await h.call({ action: "get", key: "PROJ-1" });
    const said = result.error?.message ?? result.blocked ?? result.text;
    assert.equal(said.includes("\n"), false, "one line");
    assert.ok(said.length <= 200, `jig-core cuts a refusal from a preview at 200 characters; this is ${said.length}`);
    assert.match(said, /^jira is not set up: ask the person to run \/jig setup jira;/);
    assert.match(said, /by hand, add a "jira" section with "site" and "auth" to jig\.json \(see the jig-jira README/);
    assert.ok(said.indexOf("/jig setup jira") < said.indexOf("by hand"), "the command comes first");
    assert.equal(h.jira.requests.length, 0, "nothing was sent");
});

test("a jira section that is there but fails its check is set up wrongly: the tool quotes the first problem, and names the command", async () => {
    h.reset();
    h.jig.setSection("jira", { site: "http://jira.example.test", auth: { transport: "orders-relay" } });
    const result = await h.call({ action: "get", key: "PROJ-1" });
    const said = result.error?.message ?? result.blocked ?? result.text;
    assert.equal(said.includes("\n"), false, "one line");
    assert.ok(said.length <= 200, `jig-core cuts a refusal from a preview at 200 characters; this is ${said.length}`);
    assert.match(said, /^jira's settings have a problem: jira\.site: must be an https address/);
    assert.doesNotMatch(said, /is not set up/, "the section is there");
    assert.doesNotMatch(said, /by hand, add/, "a person is not told to add what exists");
    assert.ok(said.endsWith("ask the person to fix it with /jig setup jira, or see /jig for all problems"), said);
    assert.equal(h.jira.requests.length, 0, "nothing was sent");
});

test("a section that is not there says not set up, and both lines fit the 200 characters", async () => {
    h.reset();
    h.jig.setSection("jira", undefined);
    const missing = await h.call({ action: "get", key: "PROJ-1" });
    h.jig.setSection("jira", { site: "http://jira.example.test", auth: { transport: "orders-relay" } });
    const wrong = await h.call({ action: "get", key: "PROJ-1" });
    for (const result of [missing, wrong]) {
        const said = result.error?.message ?? result.blocked ?? result.text;
        assert.ok(said.length <= 200, `${said.length} characters: ${said}`);
    }
    assert.match(missing.error?.message ?? "", /^jira is not set up: /);
    assert.match(wrong.error?.message ?? "", /^jira's settings have a problem: /);
});

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
    assert.match(
        said,
        /^jira is not set up: ask the person to run \/jig setup jira in Pi, or jig setup jira in a terminal;/,
    );
    assert.match(said, /by hand, add a "jira" section with "site" and "auth" to jig\.json \(see the jig-jira README/);
    assert.ok(said.indexOf("/jig setup jira") < said.indexOf("by hand"), "the command comes first");
    assert.equal(h.jira.requests.length, 0, "nothing was sent");
});

// `git.accounts` in jig-ops: the ci tool names a repository from the catalog (`owner/name`), and a matched mapping runs
// that one gh call with the account's token as GH_TOKEN. No mapping keeps today's behaviour, and a repository-not-found
// error names the account and the fix.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { slugOf } from "../src/ci/gh.ts";
import { ok, setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

let h: Harness;
beforeEach(() => {
    h = setupHarness();
});
afterEach(() => h.close());

const TOKEN = ["ghs", "fixture", "ci"].join("_");
const SERVICE = "orders-api";
const SLUG = "acme/orders-api";
const call = (input: Record<string, unknown>) => h.ci.call({ service: SERVICE, ...input });

test("the repository a gh call names is read from -R or a repos/ path", () => {
    assert.equal(slugOf(["pr", "checks", "42", "-R", "acme/orders-api"]), "acme/orders-api");
    assert.equal(slugOf(["api", "-i", "repos/acme/orders-api/actions/runs/1"]), "acme/orders-api");
    assert.equal(slugOf(["auth", "token", "--user", "acme-work"]), undefined);
});

test("a mapped account is used for that ci call only", async () => {
    h.jig.setSection("git", { accounts: { "github.com:acme/*": "acme-work" } });
    h.gh.on("auth token", { stdout: TOKEN }, ["--hostname", "github.com", "--user", "acme-work"]);
    h.gh.on("pr checks", { json: [{ name: "build", state: "SUCCESS", bucket: "pass", link: "" }] });
    ok(await call({ action: "status", number: 42 }));

    const [asked] = h.gh.callsOf("auth token");
    assert.deepEqual(asked?.args, ["auth", "token", "--hostname", "github.com", "--user", "acme-work"]);
    assert.equal(asked?.token, false, "reading the token carries none");
    assert.deepEqual(h.gh.callsOf("pr checks")[0]?.args.slice(-2), ["-R", SLUG]);
    assert.equal(h.gh.callsOf("pr checks")[0]?.token, true);
    assert.deepEqual(h.jig.registeredSecrets, [TOKEN]);
});

test("with no mapping, ci runs as it did", async () => {
    h.gh.on("pr checks", { json: [{ name: "build", state: "SUCCESS", bucket: "pass", link: "" }] });
    ok(await call({ action: "status", number: 42 }));
    assert.equal(h.gh.callsOf("auth token").length, 0);
    assert.equal(h.gh.callsOf("pr checks")[0]?.token, false);
});

test("a repository this account cannot see names the account and the fix", async () => {
    h.jig.setSection("git", { accounts: { "github.com:acme/*": "acme-work" } });
    h.gh.on("auth token", { stdout: TOKEN });
    h.gh.on("pr checks", { code: 1, stderr: "Could not resolve to a Repository with the name 'acme/orders-api'." });
    const result = await call({ action: "status", number: 42 });
    assert.match(result.error?.message ?? "", /used gh account "acme-work"/);
    assert.match(result.error?.message ?? "", /git\.accounts/);
});

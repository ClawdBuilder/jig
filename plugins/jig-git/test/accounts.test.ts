// `git.accounts`: a matched account is used for gh through GH_TOKEN, read from the gh that owns the login, for that one
// call. No account is switched, and no token is stored or printed. The controls: no mapping, an account with no token, a
// gh too old for --user, and the repository-not-found error that names the account and the fix.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { settingsFrom, validateGitSection } from "../src/config.ts";
import { ok, setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";
import { makeRepo } from "./support/repos.ts";

let h: Harness;
let counter = 0;

before(() => {
    h = setupHarness();
});
beforeEach(() => h.reset());
after(() => h.cleanup());

/** A token that never looks like a literal: the fake prints it, and the test checks it is registered, never shown. */
const TOKEN = ["ghs", "fixture", "account"].join("_");

function repo(): { dir: string; name: string } {
    const made = makeRepo(h.sb, `svc-accounts-${++counter}`, "acme");
    return { dir: made.dir, name: made.name };
}

function mapTo(account: string): void {
    h.jig.setSection("git", { accounts: { "github.com:acme/svc-accounts-*": account } });
}

/** What `pr view --json` answers; enough fields for the plan, not one more. */
function prJson(): Record<string, unknown> {
    return {
        number: 1,
        title: "One",
        state: "OPEN",
        isDraft: false,
        author: { login: "someone" },
        baseRefName: "main",
        headRefName: "feature/one",
        headRefOid: "1".repeat(40),
        mergeable: "MERGEABLE",
        reviewDecision: "",
        statusCheckRollup: [],
        url: "https://github.com/acme/svc/pull/1",
        body: "",
        labels: [],
        reviewRequests: [],
        autoMergeRequest: null,
    };
}

function authToken(): void {
    h.gh.on("auth token", { stdout: TOKEN }, ["--hostname", "github.com", "--user", "acme-work"]);
}

test("a mapped account is used for that call only: its token is read, registered, never switched", async () => {
    const r = repo();
    mapTo("acme-work");
    authToken();
    h.gh.on("pr view", { json: prJson() });
    const result = await h.call("pr", { action: "view", number: 1 }, { cwd: r.dir });
    ok(result);

    const [asked] = h.gh.callsOf("auth token");
    assert.deepEqual(asked?.args, ["auth", "token", "--hostname", "github.com", "--user", "acme-work"]);
    assert.equal(asked?.token, false, "reading the token passes no token of its own");
    assert.equal(h.gh.callsOf("pr view")[0]?.token, true, "the one gh call carries GH_TOKEN");
    assert.deepEqual(h.jig.registeredSecrets, [TOKEN], "the token is redacted from every result");
    assert.equal(
        h.gh.calls().some((call) => call.args.includes("switch")),
        false,
        "the active account is never switched",
    );
});

test("two repositories, two accounts: each call gets its own token, and neither becomes active", async () => {
    const work = makeRepo(h.sb, "svc-accounts-a", "acme");
    const home = makeRepo(h.sb, "svc-accounts-b", "acme");
    const workToken = ["ghs", "work"].join("_");
    const homeToken = ["ghs", "home"].join("_");
    h.jig.setSection("git", {
        accounts: {
            "github.com:acme/svc-accounts-a": "acme-work",
            "github.com:acme/svc-accounts-b": "personal",
        },
    });
    h.gh.on("auth token", { stdout: workToken }, ["--user", "acme-work"]);
    h.gh.on("auth token", { stdout: homeToken }, ["--user", "personal"]);
    h.gh.on("pr view", { json: prJson() });

    ok(await h.call("pr", { action: "view", number: 1 }, { cwd: work.dir }));
    ok(await h.call("pr", { action: "view", number: 1 }, { cwd: home.dir }));

    const tokens = h.gh.callsOf("auth token");
    assert.deepEqual(
        tokens.map((call) => call.args.at(-1)),
        ["acme-work", "personal"],
    );
    assert.deepEqual(
        h.gh.callsOf("pr view").map((call) => call.token),
        [true, true],
    );
    assert.deepEqual(h.jig.registeredSecrets.sort(), [workToken, homeToken].sort());
    assert.equal(
        h.gh.calls().some((call) => call.args.includes("switch")),
        false,
    );
});

test("with no mapping, gh runs as it did: the active account and no token of ours", async () => {
    const r = repo();
    h.gh.on("pr view", { json: prJson() });
    ok(await h.call("pr", { action: "view", number: 1 }, { cwd: r.dir }));
    assert.equal(h.gh.callsOf("auth token").length, 0);
    assert.equal(h.gh.callsOf("pr view")[0]?.token, false);
});

test("an account with no token says which account and how to sign in", async () => {
    const r = repo();
    mapTo("acme-work");
    h.gh.on("auth token", { code: 1, stderr: "no oauth token for acme-work" });
    const result = await h.call("pr", { action: "view", number: 1 }, { cwd: r.dir });
    assert.match(result.error?.message ?? "", /account "acme-work" has no token/);
    assert.match(result.error?.message ?? "", /gh auth login --hostname github\.com/);
});

test("a gh too old for --user says so in plain words", async () => {
    const r = repo();
    mapTo("acme-work");
    h.gh.on("auth token", { code: 1, stderr: "unknown flag: --user" });
    const result = await h.call("pr", { action: "view", number: 1 }, { cwd: r.dir });
    assert.match(result.error?.message ?? "", /gh is too old to choose an account/);
    assert.match(result.error?.message ?? "", /gh auth switch/);
});

test("Could not resolve to a Repository names the account used and the fix", async () => {
    const r = repo();
    mapTo("acme-work");
    authToken();
    h.gh.on("pr view", { code: 1, stderr: "Could not resolve to a Repository with the name 'acme/svc-accounts-1'." });
    const result = await h.call("pr", { action: "view", number: 1 }, { cwd: r.dir });
    assert.match(result.error?.message ?? "", /used gh account "acme-work"/);
    assert.match(result.error?.message ?? "", /git\.accounts/);
    assert.match(result.error?.message ?? "", /gh auth login/);
});

test("the git section checks the accounts map, and carries it when valid", () => {
    assert.deepEqual(validateGitSection({ accounts: { "github.com:acme/*": "acme-work" } }), []);
    assert.equal(validateGitSection({ accounts: { "acme/*": "acme-work" } }).length, 1);
    assert.equal(validateGitSection({ accounts: { "github.com:acme/*": "" } }).length, 1);
    assert.deepEqual(settingsFrom({ accounts: { "github.com:acme/*": "acme-work" } }).accounts, {
        "github.com:acme/*": "acme-work",
    });
});

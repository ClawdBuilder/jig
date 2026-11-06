// `git.accounts`: an ordered map from a remote pattern to a gh account. The pattern is matched after ssh aliases are
// resolved, so an https origin and an ssh alias for the same repository can share one entry.
import assert from "node:assert/strict";
import test from "node:test";
import { accountFor, accountPattern, accountRemote, validateAccounts } from "../src/kit/accounts.ts";

test("validates a map of host:owner/name patterns to account names", () => {
    assert.deepEqual(validateAccounts({ "github.com:acme/*": "acme-work", "github.com:me/notes": "personal" }), []);
    assert.deepEqual(validateAccounts({}), []);
    for (const bad of [undefined, null, [], "text", 7]) {
        assert.equal(validateAccounts(bad).length >= 1, true, String(bad));
    }
    for (const key of ["acme/*", "github.com", "github.com:acme", "", "github.com:"]) {
        assert.equal(validateAccounts({ [key]: "acme-work" }).length, 1, key);
    }
    assert.equal(validateAccounts({ "github.com:acme/*": "" }).length, 1);
    assert.equal(validateAccounts({ "github.com:acme/*": 7 }).length, 1);
});

test("the first matching pattern wins, and matching ignores case", () => {
    const accounts = {
        "github.com:acme/orders-*": "orders-work",
        "github.com:acme/*": "acme-work",
        "gitlab.example.com:acme/*": "gitlab-work",
    };
    assert.equal(accountFor(accounts, "github.com:acme/orders-api"), "orders-work");
    assert.equal(accountFor(accounts, "github.com:acme/billing-api"), "acme-work");
    assert.equal(accountFor(accounts, "GitHub.com:ACME/Billing-API"), "acme-work");
    assert.equal(accountFor(accounts, "gitlab.example.com:acme/orders-api"), "gitlab-work");
    assert.equal(accountFor(accounts, "github.com:other/orders-api"), undefined);
    assert.equal(accountFor(undefined, "github.com:acme/orders-api"), undefined);
});

test("a pattern is anchored, and only * is a wildcard", () => {
    assert.equal(accountPattern("github.com:acme/*").test("xgithub.com:acme/orders"), false);
    assert.equal(accountPattern("github.com:acme/*").test("github.com:acme/orders/extra"), true);
    assert.equal(accountPattern("github.com:acme/orders").test("github.com:acme/orders-api"), false);
    assert.equal(accountPattern("github.com:acme/orders.api").test("github.com:acme/ordersXapi"), false);
});

test("the remote a mapping matches is the real host and the lower-case repository path", () => {
    assert.equal(accountRemote("GitHub.com", "Acme", "Orders-API"), "github.com:acme/orders-api");
});

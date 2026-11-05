// Acme's onboarding list: the company writes its people's setup once, and jig-core checks it. The fields it names must be
// Acme's own, in the order Acme wants them asked, with its preferred store first.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkOnboarding } from "../../../plugins/jig-core/src/onboarding.ts";
import { ACME_ONBOARDING } from "../src/onboarding.ts";

describe("Acme's onboarding list", () => {
    test("is valid as jig-core checks it, so setup can follow it", () => {
        assert.deepEqual(checkOnboarding(ACME_ONBOARDING), ACME_ONBOARDING);
    });

    test("asks for Acme's own fields, in Acme's order, with Acme's preferred store first", () => {
        const named = ACME_ONBOARDING.items.filter((item) => item.kind !== "info" && item.kind !== "login");
        assert.deepEqual(
            named.map((item) => `${item.section}.${item.path}`),
            ["acme.sso.token", "acme.bastion.user", "acme.gateway.proxy"],
        );
        const token = named[0];
        assert.equal(token?.kind, "reference");
        assert.equal(ACME_ONBOARDING.preferredStore, "cmd");
        assert.equal(token?.kind === "reference" ? token.suggested?.cmd : undefined, "cmd:acme-sso");
    });

    test("names a GitHub login and says what it is for", () => {
        const login = ACME_ONBOARDING.items.find((item) => item.kind === "login");
        assert.equal(login?.kind === "login" ? login.login : undefined, "gh auth login");
    });
});

// Who is who: how two descriptions of a person are told to be the same one.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sameUser, userNamed, userOf } from "../src/values.ts";

describe("sameUser", () => {
    const cloud = userOf({ accountId: "5b10a2844c20165700ede21g", displayName: "Jane Doe" });
    const datacenter = userOf({
        name: "jdoe",
        key: "JIRAUSER10001",
        emailAddress: "Jane.Doe@example.test",
        displayName: "Jane Doe",
    });

    test("an account id, a user name, a key or an email address in common is the same person", () => {
        assert.equal(sameUser(cloud, userOf({ accountId: "5b10a2844c20165700ede21g" })), true);
        assert.equal(sameUser(datacenter, userOf({ name: "jdoe" })), true);
        assert.equal(sameUser(datacenter, userOf({ key: "JIRAUSER10001" })), true);
        assert.equal(sameUser(datacenter, userOf({ emailAddress: "jane.doe@example.test" })), true);
    });

    test("case does not matter", () => {
        assert.equal(sameUser(datacenter, userOf({ name: "JDoe" })), true);
        assert.equal(sameUser(datacenter, userOf({ key: "jirauser10001" })), true);
    });

    test("a display name is not an identity, and nobody is the same as nobody", () => {
        assert.equal(sameUser(cloud, userOf({ displayName: "Jane Doe" })), false);
        assert.equal(sameUser(userOf({}), userOf({})), false);
        assert.equal(sameUser(cloud, datacenter), false);
    });

    test("a person known only by a text matches by whichever identifier that text is", () => {
        for (const text of ["5b10a2844c20165700ede21g", "5B10A2844C20165700EDE21G"]) {
            assert.equal(sameUser(cloud, userNamed(text)), true, text);
        }
        for (const text of ["jdoe", "JIRAUSER10001", "jane.doe@example.test"]) {
            assert.equal(sameUser(datacenter, userNamed(text)), true, text);
        }
        assert.equal(sameUser(datacenter, userNamed("Jane Doe")), false);
        assert.equal(sameUser(cloud, userNamed("jdoe")), false);
    });
});

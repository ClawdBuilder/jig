// The environment a sandboxed command starts with: credentials out, the rest as Pi has it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { looksLikeCredential, looksLikeCredentialValue, scrubEnvironment } from "../src/env.ts";

describe("which names are removed", () => {
    test("names that look like credentials, whatever their case", () => {
        for (const name of [
            "GITHUB_TOKEN",
            "github_token",
            "NPM_TOKEN",
            "MY_SECRET",
            "DB_PASSWORD",
            "DB_PASSWD",
            "STRIPE_API_KEY",
            "SERVICE_KEY",
            "APIKEY",
            "SOME_APIKEY_VALUE",
            "REGISTRY_CREDENTIALS",
            "AWS_PROFILE",
            "AWS_ACCESS_KEY_ID",
            "AZURE_CLIENT_ID",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "GH_HOST",
            "GITHUB_ACTIONS",
            "VAULT_ADDR",
            "KUBECONFIG",
            "SSH_AUTH_SOCK",
            "GPG_AGENT_INFO",
            "DBUS_SESSION_BUS_ADDRESS",
            "WSL_INTEROP",
        ]) {
            assert.equal(looksLikeCredential(name), true, name);
        }
    });

    test("names that hold a password or a secret address without saying so", () => {
        for (const name of ["MYSQL_PWD", "SENTRY_DSN", "SLACK_WEBHOOK", "JIRA_PAT", "MONGO_PWD"]) {
            assert.equal(looksLikeCredential(name), true, name);
        }
        for (const name of ["PWD", "DSN", "WEBHOOK_URL"]) {
            // The suffix alone is the sign, not a word inside a longer name.
            assert.equal(looksLikeCredential(name), false, name);
        }
    });

    test("ordinary names are kept", () => {
        for (const name of [
            "PATH",
            "HOME",
            "LANG",
            "TERM",
            "JAVA_HOME",
            "KEYBOARD_LAYOUT",
            "MONKEY",
            "PI_SESSION_ID",
            "TMPDIR",
            "NODE_ENV",
            "CI",
        ]) {
            assert.equal(looksLikeCredential(name), false, name);
        }
    });
});

describe("a value with a password in its address", () => {
    test("is a credential whatever the variable is called", () => {
        for (const value of [
            "postgres://user:hunter2@db.example/orders",
            "mysql://root:secret@127.0.0.1:3306/app",
            "redis://:pw@cache:6379/0",
            "mongodb+srv://u:p@cluster.example/db",
        ]) {
            assert.equal(looksLikeCredentialValue(value), true, value);
        }
    });

    test("an address without a password, or a plain value, is not", () => {
        for (const value of ["https://example.com/path", "mongodb://db.example/app", "postgres://db/app", "hello"]) {
            assert.equal(looksLikeCredentialValue(value), false, value);
        }
    });
});

describe("scrubEnvironment", () => {
    const source = {
        PATH: "/usr/bin:/mnt/c/Windows:/mnt/c/Program Files/Git/cmd:/home/me/bin",
        HOME: "/home/me",
        GITHUB_TOKEN: "ghs_0123456789abcdef",
        SHORT_SECRET: "abc",
        MY_API_KEY: "key-value-long-enough",
        LANG: "C.UTF-8",
    };

    test("removes credentials and says which, in order, with the values worth scrubbing from output", () => {
        const result = scrubEnvironment(source, { keep: [] });
        assert.deepEqual(result.env, { PATH: source.PATH, HOME: "/home/me", LANG: "C.UTF-8" });
        assert.deepEqual(result.removed, ["GITHUB_TOKEN", "MY_API_KEY", "SHORT_SECRET"]);
        assert.deepEqual(
            result.values,
            ["key-value-long-enough", "ghs_0123456789abcdef"],
            "longest first, and a value of three letters is not scrubbed from output",
        );
    });

    test("a variable named like nothing in particular is removed when its value holds a password", () => {
        const result = scrubEnvironment(
            { DATABASE_URL: "postgres://user:hunter2@db.example/orders", MONGO_URL: "mongodb://db.example/app" },
            { keep: [] },
        );
        assert.deepEqual(
            result.env,
            { MONGO_URL: "mongodb://db.example/app" },
            "no password, so no reason to remove it",
        );
        assert.deepEqual(result.removed, ["DATABASE_URL"]);
        assert.deepEqual(result.values, ["postgres://user:hunter2@db.example/orders"]);
    });

    test("`env.keep` passes a named variable through, without regard to case", () => {
        const result = scrubEnvironment(source, { keep: ["my_api_key"] });
        assert.equal(result.env.MY_API_KEY, "key-value-long-enough");
        assert.ok(!result.removed.includes("MY_API_KEY"));
        assert.equal(result.env.GITHUB_TOKEN, undefined);
    });

    test("PATH entries inside hidden folders are dropped, and variables are added", () => {
        const result = scrubEnvironment(source, { keep: [], hiddenFolders: ["/mnt"], set: { TMPDIR: "/tmp/session" } });
        assert.equal(result.env.PATH, "/usr/bin:/home/me/bin");
        assert.equal(result.env.TMPDIR, "/tmp/session");
    });

    test("the source is not changed", () => {
        const copy = { ...source };
        scrubEnvironment(source, { keep: [] });
        assert.deepEqual(source, copy);
    });

    test("an undefined value is not passed on", () => {
        assert.deepEqual(scrubEnvironment({ A: undefined, B: "1" }, { keep: [] }).env, { B: "1" });
    });
});

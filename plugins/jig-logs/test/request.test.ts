// The one request function: a network failure is described in the plugin's own words, never by the error underneath it.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Backend } from "../src/config.ts";
import { sender } from "../src/request.ts";
import { installFakeJig } from "./support/fake-jig.ts";

const BACKEND: Backend = {
    kind: "direct",
    url: "https://logs.example.com",
    auth: { kind: "bearer", token: "env:T" },
};
const wire = (): { method: "GET"; path: string } => ({ method: "GET", path: "/loki/api/v1/query_range" });
const CANNOT_REACH = "cannot reach the backend: check backend.url, the network and the certificate";

function withNetwork(failure: () => Promise<never>): { jig: ReturnType<typeof installFakeJig> } {
    const jig = installFakeJig();
    jig.secrets.set("env:T", "a-token-value");
    jig.setFetch(failure);
    return { jig };
}

test("fetch's own TypeError is described in the plugin's words", async () => {
    const { jig } = withNetwork(async () => {
        throw new TypeError("fetch failed");
    });
    try {
        await assert.rejects(sender(BACKEND, wire)({}), new Error(CANNOT_REACH));
    } finally {
        jig.remove();
    }
});

test("a network error with any other cause is described the same way, not passed through", async () => {
    const { jig } = withNetwork(async () => {
        throw new Error("getaddrinfo ENOTFOUND logs.internal");
    });
    try {
        await assert.rejects(sender(BACKEND, wire)({}), (error: Error) => {
            assert.equal(error.message, CANNOT_REACH);
            assert.doesNotMatch(error.message, /ENOTFOUND|logs\.internal/, "never the error text from below");
            return true;
        });
    } finally {
        jig.remove();
    }
});

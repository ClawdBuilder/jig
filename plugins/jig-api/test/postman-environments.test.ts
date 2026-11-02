// The `postman-environments` action: the environments a Postman API key can see, by name and id, so the agent can map one in the
// configuration without fetching any variable. Tried against a fake Postman API on this machine. The answer it serves carries a
// value that must never come back, and the key is a canary that must be in no result or error.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { startFakeApi } from "./support/fake-api.ts";
import type { FakeApi, Recorded, Reply } from "./support/fake-api.ts";
import { ok, setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

const KEY = ["PMAK", "9f8e7d6c5b4a39281706f5e4-d3c2b1a09f8e7d6c5b4a39281706f5e4d3"].join("-");
const KEY_REFERENCE = "pass:postman/api-key";
const COLLECTION_ID = "12345678-aaaa1111-bbbb-2222-cccc-3333dddd4444";
const VALUE_CANARY = "value-that-must-never-be-listed-0042";

let h: Harness;
let postman: FakeApi;
let state: string;
let saved: string | undefined;

/** The list of environments as the Postman API returns it. A stray `values` field stands for anything else the API may add. */
function answer(request: Recorded): Reply {
    if (request.headers["x-api-key"] !== KEY)
        return { status: 401, body: `{"error":{"message":"Invalid API Key: ${KEY}"}}` };
    if (request.path !== "/environments") return { status: 404, body: "{}" };
    const all = [
        {
            id: "5daabc50-8451-43f6-922d-96b403b4f28e",
            name: "Staging",
            owner: "12345678",
            uid: "12345678-5daabc50-8451-43f6-922d-96b403b4f28e",
            updatedAt: "2026-10-30T10:15:00.000Z",
            values: [{ key: "token", value: VALUE_CANARY }],
        },
        { id: "0b1c2d3e-0000-4000-8000-000000000001", name: "Production\u0007", owner: "12345678" },
        { name: "no id" },
    ];
    const workspace = new URLSearchParams(request.query).get("workspace");
    return { body: JSON.stringify({ environments: workspace === "ws-1" ? all.slice(0, 1) : all }) };
}

before(async () => {
    h = await setupHarness();
    postman = await startFakeApi();
    saved = process.env.JIG_STATE_DIR;
});
after(async () => {
    if (saved === undefined) delete process.env.JIG_STATE_DIR;
    else process.env.JIG_STATE_DIR = saved;
    await postman.close();
    await h.close();
});

function configure(collections: Record<string, unknown>): void {
    h.jig.secrets.set(KEY_REFERENCE, KEY);
    h.configure({ collections, environments: { Staging: "staging" }, allowPlainLocal: true });
}

const cloud = (extra: Record<string, unknown> = {}) => ({
    postman: { cloud: COLLECTION_ID, apiKey: KEY_REFERENCE, ...extra },
});

beforeEach(() => {
    h.reset();
    postman.reset();
    postman.respond = answer;
    h.options.postmanApi = postman.origin;
    state = fs.mkdtempSync(path.join(os.tmpdir(), "jig-api-envs-"));
    process.env.JIG_STATE_DIR = state;
    fs.mkdirSync(path.join(h.dir, "ledger"));
    configure({ cloud: cloud(), ledger: { http: path.join(h.dir, "ledger") } });
});
afterEach(() => fs.rmSync(state, { recursive: true, force: true }));

test("lists names and ids, sorted, with the owner and time, and never a value or the key", async () => {
    const result = await h.call({ action: "postman-environments" });
    const text = ok(result);
    assert.deepEqual(result.cls, { action: "postman-environments", environment: "external", effect: "read" });
    assert.equal(
        text,
        [
            "Postman environments the key can see, with the key of cloud: 2 (names and ids only; values are never fetched)",
            "- Production | 0b1c2d3e-0000-4000-8000-000000000001 | owner 12345678",
            "- Staging | 12345678-5daabc50-8451-43f6-922d-96b403b4f28e | owner 12345678 | updated 2026-10-30T10:15:00.000Z",
            "",
            'To use one, add it to api.collections.cloud.postman.environments as { "Staging": "<id>" }, then /api refresh cloud.',
        ].join("\n"),
    );
    assert.doesNotMatch(JSON.stringify(result), new RegExp(VALUE_CANARY));
    assert.doesNotMatch(JSON.stringify(result), /PMAK-/);
    assert.equal(postman.requests.length, 1);
    assert.equal(postman.requests[0]?.method, "GET");
    assert.equal(postman.requests[0]?.headers["x-api-key"], KEY, "jig-core attached the key");
    assert.deepEqual(
        fs.readdirSync(state, { recursive: true }).filter((name) => String(name).endsWith(".json")),
        [],
        "nothing is saved",
    );
});

test("a workspace narrows the list, and a bad workspace id is refused before anything is sent", async () => {
    const text = ok(await h.call({ action: "postman-environments", workspace: "ws-1" }));
    assert.match(text, /^Postman environments in workspace ws-1, with the key of cloud: 1 /);
    assert.equal(postman.requests[0]?.query, "workspace=ws-1");
    const blocked = await h.call({ action: "postman-environments", workspace: "../x" });
    assert.match(blocked.blocked ?? "", /workspace: must be the id of a Postman workspace/);
    assert.equal(postman.requests.length, 1);
});

test("a key that is not accepted is a failure in a few words, without the key", async () => {
    h.jig.secrets.set(KEY_REFERENCE, ["PMAK", "0000000000000000000000-wrong"].join("-"));
    const result = await h.call({ action: "postman-environments" });
    assert.equal(
        result.error?.message,
        "Could not list the Postman environments with the key of cloud: the API key was not accepted (HTTP 401).",
    );
});

test("without a Postman cloud collection, or with several and none named, the call is refused and says what to do", async () => {
    configure({ ledger: { http: path.join(h.dir, "ledger") } });
    assert.match(
        (await h.call({ action: "postman-environments" })).blocked ?? "",
        /No collection is a Postman cloud collection: add one under api\.collections/,
    );
    assert.match(
        (await h.call({ action: "postman-environments", collection: "ledger" })).blocked ?? "",
        /ledger is not a Postman cloud collection\. Postman cloud collections: none$/,
    );
    configure({ cloud: cloud(), other: cloud({ cloud: "12345678-bbbb" }) });
    assert.match(
        (await h.call({ action: "postman-environments" })).blocked ?? "",
        /Several Postman cloud collections \(cloud, other\): name the one whose key to use in collection$/,
    );
    assert.match(
        ok(await h.call({ action: "postman-environments", collection: "other" })),
        /with the key of other: 2 /,
    );
    assert.equal(postman.requests.length, 1);
});

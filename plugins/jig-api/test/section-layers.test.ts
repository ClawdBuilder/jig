// The api section a teammate writes is laid over the company's defaults. A collection entry is one source among several, so
// it is a `replace` path: a teammate who points a company collection at their own `.http` folder gets their source whole,
// instead of an object holding both sources and failing the "use exactly one source" check for the whole section.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { start } from "../../jig-core/test/support/harness.ts";
import type { Harness } from "../../jig-core/test/support/harness.ts";
import { tempState } from "../../jig-core/test/support/state.ts";
import { jigApi } from "../src/index.ts";
import type { ApiSettings } from "../src/config.ts";

const state = tempState();
let harness: Harness | undefined;

before(() => state.start());
after(async () => {
    await harness?.shutdown();
    state.stop();
});

/** Loads the plugin's own registration only: its tools and command go to a stub, and no call is made. */
function registerPlugin(): void {
    const pi = {
        registerTool: () => {},
        registerCommand: () => {},
        on: () => () => {},
    } as unknown as ExtensionAPI;
    jigApi()(pi);
}

const collectionsOf = (h: Harness): Record<string, Record<string, unknown>> =>
    (h.api.config.section("api") as ApiSettings).collections as unknown as Record<string, Record<string, unknown>>;

test("a teammate's collection replaces the company's for the same name, rather than merging the two sources", async () => {
    harness = await start({
        config: { api: { collections: { orders: { http: "/tmp/orders-http" } } } },
        plugins: (api) => {
            api.config.addSectionDefaults("api", {
                collections: { orders: { postman: "/tmp/orders.postman_collection.json" } },
            });
            registerPlugin();
        },
    });
    assert.deepEqual(collectionsOf(harness).orders, { http: "/tmp/orders-http" });
    // The merged object is valid, so nothing is reported: without the replace the two sources would be laid together and
    // `/jig` would show "use exactly one source (got postman, http)" on every session.
    assert.deepEqual(
        harness.notifications().filter((line) => /configuration problem/i.test(line)),
        [],
    );
});

test("with no section of their own, a teammate gets the company's collection", async () => {
    harness = await start({
        config: {},
        plugins: (api) => {
            api.config.addSectionDefaults("api", {
                collections: { orders: { postman: "/tmp/orders.postman_collection.json" } },
            });
            registerPlugin();
        },
    });
    assert.deepEqual(collectionsOf(harness).orders, { postman: "/tmp/orders.postman_collection.json" });
});

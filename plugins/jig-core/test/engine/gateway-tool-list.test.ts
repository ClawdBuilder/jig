// What the gateway lists for a tool: the parameters an agent is shown, made from the tool's own schema. A tool that works on a folder gets one more optional
// text, `dir`; the actions a connector keeps back are not in the list, so the SDK's own check rejects them. The real schemas of jig-git are used, with the
// SDK's `fromJsonSchema`, which is what the server registers a tool with.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import connector from "../../../jig-git/src/connector.ts";
import type { EngineTool } from "../../src/engine-tool.ts";
import { DIR_DESCRIPTION, describeTool, mcpInputSchema } from "../../src/gateway/tool-list.ts";
import { stampTool } from "../support/test-tool.ts";

const tool = (name: string): EngineTool => {
    const found = connector.tools.find((one) => one.tool === name);
    if (found === undefined) throw new Error(`the connector has no ${name}`);
    return found;
};

/** What the SDK's check says of a value against a listed schema: undefined when it is accepted, else the first complaint. */
async function complaint(schema: Record<string, unknown>, value: unknown): Promise<string | undefined> {
    const result = await fromJsonSchema(schema as JsonSchemaType)["~standard"].validate(value);
    return result.issues?.[0]?.message;
}

const properties = (schema: Record<string, unknown>) => schema.properties as Record<string, Record<string, unknown>>;

describe("the parameters of a tool as the gateway lists them", () => {
    test("a tool that works on a folder gets one more optional text, dir, and no other parameter changes", () => {
        const pr = tool("pr");
        const listed = mcpInputSchema("pr", pr.input, { usesFolder: true, notOffered: [] });
        assert.deepEqual(properties(listed).dir, { type: "string", description: DIR_DESCRIPTION });
        assert.deepEqual(Object.keys(properties(listed)), [...Object.keys(properties(pr.input)), "dir"]);
        assert.deepEqual(listed.required, ["action"], "dir is optional");
        assert.equal(listed.additionalProperties, false);
    });

    test("a tool that does not work on a folder has no dir", () => {
        const stamp = stampTool().tool;
        const listed = mcpInputSchema("stamp", stamp.input, { usesFolder: false, notOffered: [] });
        assert.deepEqual(listed, stamp.input);
        assert.equal("dir" in properties(listed), false);
    });

    test("the actions a connector keeps back are out of the action list and out of the lines that describe the actions", () => {
        const release = tool("release");
        const listed = mcpInputSchema("release", release.input, { usesFolder: true, notOffered: ["tag_create"] });
        const action = properties(listed).action as { enum: string[]; description: string };
        assert.deepEqual(action.enum, ["tags", "releases", "tag_push", "release_create"]);
        assert.match(action.description, /^- tags: /);
        assert.match(action.description, /\n- tag_push: push a tag/);
        assert.doesNotMatch(action.description, /tag_create/);
    });

    test("the tool's own schema is not changed: Pi shows the same tool with it", () => {
        const pr = tool("pr");
        const before = JSON.stringify(pr.input);
        mcpInputSchema("pr", pr.input, { usesFolder: true, notOffered: ["watch"] });
        assert.equal(JSON.stringify(pr.input), before);
        assert.match(before, /"watch"/);
        assert.doesNotMatch(before, /"dir"/);
    });

    test("the same tool gives the same bytes every time", () => {
        const first = JSON.stringify(describeTool(tool("pr"), "jig-git", ["watch"]));
        const second = JSON.stringify(describeTool(tool("pr"), "jig-git", ["watch"]));
        assert.equal(first, second);
    });

    test("a tool with no action list is left as it is, apart from dir; a parameter already named dir is a mistake", () => {
        const bare = { type: "object", properties: { text: { type: "string" } }, additionalProperties: false };
        const listed = mcpInputSchema("bare", bare, { usesFolder: true, notOffered: ["watch"] });
        assert.deepEqual(Object.keys(properties(listed)), ["text", "dir"]);
        assert.deepEqual(mcpInputSchema("bare", { type: "object" }, { usesFolder: true, notOffered: [] }).properties, {
            dir: { type: "string", description: DIR_DESCRIPTION },
        });
        assert.throws(
            () =>
                mcpInputSchema(
                    "odd",
                    { type: "object", properties: { dir: { type: "string" } } },
                    { usesFolder: true, notOffered: [] },
                ),
            /odd works on a folder and already has a parameter named dir/,
        );
    });
});

describe("an entry of the tool list", () => {
    test("names the tool, its title and text, where it came from, and how a call to it runs", () => {
        const entry = describeTool(tool("pr"), "jig-git", ["watch"]);
        assert.equal(entry.name, "pr");
        assert.equal(entry.title, "Pull request");
        assert.equal(entry.description, tool("pr").description);
        assert.equal(entry.connector, "jig-git");
        assert.equal(entry.sequential, true);
        assert.equal(entry.usesFolder, true);
        assert.deepEqual(entry.notOffered, ["watch"]);
        const stamp = describeTool(stampTool().tool, "jig-test");
        assert.deepEqual([stamp.sequential, stamp.usesFolder, stamp.notOffered], [true, false, []]);
    });

    test("sends nothing that is Pi's or the engine's", () => {
        const keys = Object.keys(describeTool(tool("pr"), "jig-git", [])).sort();
        assert.deepEqual(keys, [
            "connector",
            "description",
            "inputSchema",
            "name",
            "notOffered",
            "sequential",
            "title",
            "usesFolder",
        ]);
    });
});

describe("the SDK's check of a call against the listed schemas of pr and release", () => {
    const pr = describeTool(tool("pr"), "jig-git", ["watch"]).inputSchema;
    const release = describeTool(tool("release"), "jig-git", ["tag_create"]).inputSchema;

    test("accepts the real actions, with and without dir", async () => {
        assert.equal(await complaint(pr, { action: "list" }), undefined);
        assert.equal(await complaint(pr, { action: "view", number: 3, dir: "/work/alpha" }), undefined);
        assert.equal(await complaint(release, { action: "tags", dir: "/work/alpha" }), undefined);
    });

    test("rejects an action that is kept back, an unknown action and a property the tool does not have", async () => {
        assert.match((await complaint(pr, { action: "watch", number: 3 })) ?? "", /allowed values/);
        assert.match((await complaint(release, { action: "tag_create" })) ?? "", /allowed values/);
        assert.match((await complaint(pr, { action: "nope" })) ?? "", /allowed values/);
        assert.match(
            (await complaint(pr, { action: "list", nonesuch: 1 })) ?? "",
            /must NOT have additional properties/,
        );
        assert.match((await complaint(pr, { action: "list", dir: 5 })) ?? "", /string/);
    });

    test("the form shown for a tool without dir rejects dir", async () => {
        const stamp = describeTool(stampTool().tool, "jig-test").inputSchema;
        assert.match(
            (await complaint(stamp, { action: "read", dir: "/work" })) ?? "",
            /must NOT have additional properties/,
        );
    });
});

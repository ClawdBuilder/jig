// The parameters of the tool: one flat schema, a table of what each action takes, and errors that show the right usage.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ACTION_NAMES, ACTIONS, isAction, parameters, parseCall, projectsQuery, usage } from "../src/params.ts";
import type { Call } from "../src/params.ts";

const parse = (input: Record<string, unknown>): Call => parseCall(input);

/** The message of the TypeError a call raises, as jig-core would show it. */
function problem(input: Record<string, unknown>): string {
    try {
        parseCall(input);
    } catch (error) {
        assert.ok(error instanceof TypeError, "a mistake in a call is a TypeError, which blocks it without asking");
        return error.message;
    }
    return assert.fail(`expected ${JSON.stringify(input)} to be refused`);
}

describe("the schema", () => {
    const schema = parameters as unknown as {
        type: string;
        required?: string[];
        properties: Record<string, { enum?: string[]; description?: string }>;
        anyOf?: unknown;
    };

    test("is one flat object whose only required parameter is the action", () => {
        assert.equal(schema.type, "object");
        assert.deepEqual(schema.required, ["action"]);
        assert.equal(schema.anyOf, undefined, "several model providers reject a top-level union");
    });

    test("lists every action, so /jig rules can show a line for each", () => {
        assert.deepEqual(schema.properties.action?.enum, ACTION_NAMES);
        assert.deepEqual(ACTION_NAMES, [
            "get",
            "search",
            "comments",
            "transitions",
            "changelog",
            "attachments",
            "assignable",
            "find_field",
            "link_types",
            "create",
            "comment",
            "edit_comment",
            "delete_comment",
            "transition",
            "update",
            "link",
            "unlink",
        ]);
    });

    test("lists each action in the description and its needs in the usage line, and keeps descriptions short", () => {
        const description = schema.properties.action?.description ?? "";
        for (const name of ACTION_NAMES) {
            assert.match(description, new RegExp(`\\b${name}\\b`));
            assert.ok(usage(name).includes(ACTIONS[name].required.join(", ")), `${name}: ${usage(name)}`);
        }
        for (const [name, property] of Object.entries(schema.properties)) {
            assert.ok(
                (property.description ?? "").length <= (name === "action" ? 360 : 120),
                `${name}: ${property.description}`,
            );
        }
    });

    test("every parameter an action uses is in the schema", () => {
        for (const name of ACTION_NAMES) {
            for (const param of [...ACTIONS[name].required, ...ACTIONS[name].optional])
                assert.ok(param in schema.properties, `${name} uses ${param}`);
        }
    });
});

describe("a search with no JQL", () => {
    test("is refused without projects, as it always was", () => {
        assert.equal(
            problem({ action: "search" }),
            "jira search needs jql. Usage: jira search {jql, limit?, page?, include?, commented?}",
        );
        assert.throws(() => parseCall({ action: "search" }, { projects: [] }), /jira search needs jql/);
    });

    test("looks in the user's projects, newest first", () => {
        assert.deepEqual(parseCall({ action: "search", limit: 5 }, { projects: ["PROJ", "OPS"] }), {
            action: "search",
            jql: 'project in ("PROJ", "OPS") ORDER BY updated DESC',
            limit: 5,
            page: undefined,
            include: [],
        });
        assert.equal(projectsQuery(["PROJ"]), 'project in ("PROJ") ORDER BY updated DESC');
    });

    test("is not used when the call has its own JQL, which is sent as it is", () => {
        const call = parseCall({ action: "search", jql: "assignee = currentUser()" }, { projects: ["PROJ"] });
        assert.equal(call.action === "search" && call.jql, "assignee = currentUser()");
    });

    test("the projects open nothing else: other actions still need their parameters", () => {
        assert.throws(() => parseCall({ action: "get" }, { projects: ["PROJ"] }), /jira get needs key/);
    });
});

describe("a call is checked against its action's table", () => {
    test("the usage line lists the needed parameters, then the optional ones with a question mark", () => {
        assert.equal(usage("comment"), "Usage: jira comment {key, text}");
        assert.equal(usage("get"), "Usage: jira get {key, include?, full?}");
        assert.equal(usage("search"), "Usage: jira search {jql, limit?, page?, include?, commented?}");
        assert.equal(usage("create"), "Usage: jira create {project, type, summary, description?, fields?}");
    });

    test("a missing parameter is named, with the usage", () => {
        assert.equal(
            problem({ action: "comment", key: "PROJ-1" }),
            "jira comment needs text. Usage: jira comment {key, text}",
        );
        assert.equal(
            problem({ action: "edit_comment" }),
            "jira edit_comment needs key, commentId, text. Usage: jira edit_comment {key, commentId, text}",
        );
        assert.equal(
            problem({ action: "search", jql: null }),
            "jira search needs jql. Usage: jira search {jql, limit?, page?, include?, commented?}",
        );
    });

    test("a parameter the action does not use is named, with the usage", () => {
        assert.equal(
            problem({ action: "get", key: "PROJ-1", text: "hi", jql: "x" }),
            "jira get does not use text, jql. Usage: jira get {key, include?, full?}",
        );
        assert.equal(
            problem({ action: "transitions", key: "PROJ-1", limit: 3 }),
            "jira transitions does not use limit. Usage: jira transitions {key}",
        );
    });

    test("an empty value counts as not given", () => {
        assert.equal(parse({ action: "get", key: "PROJ-1", include: null, full: null }).action, "get");
    });

    test("an unknown action lists the actions", () => {
        assert.match(
            problem({ action: "relink" }),
            /^jira: action must be one of get, search, comments, .* \(got "relink"\)$/,
        );
        assert.match(problem({}), /\(got undefined\)$/);
        assert.match(problem({ action: "__proto__" }), /got "__proto__"/);
        assert.equal(isAction("constructor"), false);
        assert.equal(isAction("get"), true);
    });

    test("every message stays within the 200 characters jig-core shows a blocked call", () => {
        const long = "x".repeat(500);
        const inputs: Array<Record<string, unknown>> = [
            {},
            { action: long },
            { action: "get" },
            { action: "get", key: long },
            { action: "get", key: "PROJ-1", extra: long },
            { action: "search", jql: "" },
            { action: "search", jql: "a", limit: 99 },
            { action: "comments", key: "PROJ-1", limit: 0 },
            { action: "create", project: "p r", type: "Bug", summary: "s" },
            { action: "create", project: "PROJ", type: long, summary: "s" },
            { action: "create", project: "PROJ", type: "Bug", summary: long },
            { action: "comment", key: "PROJ-1", text: long.repeat(80) },
            { action: "edit_comment", key: "PROJ-1", commentId: "abc", text: "t" },
            { action: "update", key: "PROJ-1", fields: [] },
            { action: "update", key: "PROJ-1", fields: {} },
            { action: "find_field", query: "a" },
            { action: "transition", key: "PROJ-1", transition: long },
        ];
        for (const input of inputs) {
            const message = problem(input);
            assert.ok(message.length <= 200, `${message.length} characters: ${message.slice(0, 80)}`);
            assert.match(message, /^jira/);
        }
    });
});

describe("the values", () => {
    test("an issue key is upper-cased and checked", () => {
        assert.deepEqual(parse({ action: "get", key: " proj-12 " }), {
            action: "get",
            key: "PROJ-12",
            include: [],
            full: false,
        });
        for (const key of ["PROJ", "PROJ-0", "12-PROJ", "PROJ-1a", "PROJ 1", "../x", 12]) {
            assert.match(
                problem({ action: "get", key }),
                /^jira get: key must be an issue key such as PROJ-123/,
                String(key),
            );
        }
    });

    test("a comment id is the number comments shows", () => {
        assert.equal(parse({ action: "delete_comment", key: "PROJ-1", commentId: "10003" }).action, "delete_comment");
        assert.deepEqual(parse({ action: "delete_comment", key: "PROJ-1", commentId: 10003 }), {
            action: "delete_comment",
            key: "PROJ-1",
            commentId: "10003",
        });
        for (const commentId of ["abc", "-1", "1.5", "../1", ""])
            assert.match(
                problem({ action: "delete_comment", key: "PROJ-1", commentId }),
                /commentId must be the numeric id that comments shows/,
            );
    });

    test("limit has a default and a ceiling per action", () => {
        const limitOf = (action: string, limit?: number): number => {
            const target = action === "search" ? { jql: "a" } : { key: "PROJ-1" };
            return (parse({ action, ...target, ...(limit === undefined ? {} : { limit }) }) as { limit: number }).limit;
        };
        assert.deepEqual(
            [limitOf("search"), limitOf("comments"), limitOf("changelog"), limitOf("assignable")],
            [20, 20, 30, 20],
        );
        assert.deepEqual(
            [limitOf("search", 50), limitOf("comments", 100), limitOf("changelog", 100), limitOf("assignable", 50)],
            [50, 100, 100, 50],
        );
        assert.match(
            problem({ action: "search", jql: "a", limit: 51 }),
            /limit must be a whole number from 1 to 50 \(got 51\)/,
        );
        assert.match(problem({ action: "comments", key: "PROJ-1", limit: 101 }), /from 1 to 100/);
        assert.match(problem({ action: "search", jql: "a", limit: 1.5 }), /limit must be a whole number/);
        assert.match(problem({ action: "search", jql: "a", limit: 0 }), /limit must be a whole number/);
    });

    test("a JQL query is one line of text", () => {
        assert.equal(
            (
                parse({ action: "search", jql: "project = PROJ\n  AND status = Open\t\nORDER BY created" }) as {
                    jql: string;
                }
            ).jql,
            "project = PROJ AND status = Open ORDER BY created",
        );
        assert.match(problem({ action: "search", jql: "   " }), /jql must be text of 1 to 8000 characters/);
        assert.match(problem({ action: "search", jql: "x".repeat(8001) }), /jql must be text of 1 to 8000 characters/);
    });

    test("page, include and full", () => {
        assert.deepEqual(
            parse({ action: "search", jql: "a", page: "40", include: ["Story Points", " customfield_1 "] }),
            {
                action: "search",
                jql: "a",
                limit: 20,
                page: "40",
                include: ["Story Points", "customfield_1"],
            },
        );
        assert.match(
            problem({ action: "search", jql: "a", include: Array.from({ length: 11 }, () => "x") }),
            /include must be a list of at most 10 field names or ids/,
        );
        assert.match(problem({ action: "get", key: "PROJ-1", include: "x" }), /include must be a list/);
        assert.match(problem({ action: "get", key: "PROJ-1", full: "yes" }), /full must be true or false/);
        assert.equal((parse({ action: "comments", key: "PROJ-1", full: true }) as { full: boolean }).full, true);
    });

    test("text is non-empty, within Jira's limit and has no NUL", () => {
        assert.deepEqual(parse({ action: "comment", key: "PROJ-1", text: "  keep the spaces\nand lines  " }), {
            action: "comment",
            key: "PROJ-1",
            text: "  keep the spaces\nand lines  ",
        });
        assert.match(problem({ action: "comment", key: "PROJ-1", text: "   " }), /text must be non-empty text/);
        assert.match(
            problem({ action: "comment", key: "PROJ-1", text: "a".repeat(32768) }),
            /text is 32768 characters; Jira refuses text over 32767/,
        );
        assert.equal(parse({ action: "comment", key: "PROJ-1", text: "a".repeat(32767) }).action, "comment");
        assert.match(
            problem({ action: "comment", key: "PROJ-1", text: "a\u0000b" }),
            /text must not contain a NUL character/,
        );
    });

    test("create: a project key, a type, a one-line summary, and an optional description and fields", () => {
        assert.deepEqual(
            parse({
                action: "create",
                project: "proj",
                type: " Bug ",
                summary: "  Login crashes  ",
                description: "h3. Steps",
                fields: { labels: ["a"] },
            }),
            {
                action: "create",
                project: "PROJ",
                type: "Bug",
                summary: "Login crashes",
                description: "h3. Steps",
                fields: { labels: ["a"] },
            },
        );
        assert.deepEqual(parse({ action: "create", project: "PROJ", type: "Bug", summary: "s" }), {
            action: "create",
            project: "PROJ",
            type: "Bug",
            summary: "s",
            description: undefined,
            fields: {},
        });
        assert.match(
            problem({ action: "create", project: "PROJ-1", type: "Bug", summary: "s" }),
            /project must be a project key such as PROJ/,
        );
        assert.match(
            problem({ action: "create", project: "PROJ", type: "Bug", summary: "two\nlines" }),
            /summary: must be one line of 1 to 255 characters/,
        );
        assert.match(
            problem({ action: "create", project: "PROJ", type: "Bug", summary: "a".repeat(256) }),
            /summary: must be one line/,
        );
    });

    test("fields is an object of 1 to 30 fields", () => {
        assert.match(problem({ action: "update", key: "PROJ-1", fields: {} }), /fields must name 1 to 30 fields/);
        assert.match(problem({ action: "update", key: "PROJ-1", fields: ["labels"] }), /fields must be an object/);
        assert.match(problem({ action: "update", key: "PROJ-1", fields: "labels" }), /fields must be an object/);
        assert.match(
            problem({
                action: "update",
                key: "PROJ-1",
                fields: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`f${index}`, 1])),
            }),
            /1 to 30 fields/,
        );
    });

    test("a transition is a name or an id", () => {
        assert.deepEqual(parse({ action: "transition", key: "PROJ-1", transition: " Resolve Issue " }), {
            action: "transition",
            key: "PROJ-1",
            transition: "Resolve Issue",
        });
        assert.match(
            problem({ action: "transition", key: "PROJ-1", transition: "x".repeat(101) }),
            /transition must be text of 1 to 100 characters/,
        );
    });

    test("link and unlink take two different issue keys, and link needs a link type", () => {
        assert.deepEqual(parse({ action: "link", key: "proj-1", to: " proj-2 ", linkType: " Blocks " }), {
            action: "link",
            key: "PROJ-1",
            to: "PROJ-2",
            linkType: "Blocks",
        });
        assert.deepEqual(parse({ action: "unlink", key: "PROJ-1", to: "PROJ-2" }), {
            action: "unlink",
            key: "PROJ-1",
            to: "PROJ-2",
            linkType: undefined,
        });
        assert.equal(
            (parse({ action: "unlink", key: "PROJ-1", to: "PROJ-2", linkType: "is blocked by" }) as any).linkType,
            "is blocked by",
        );
        assert.deepEqual(parse({ action: "link_types" }), { action: "link_types" });
        assert.equal(usage("link"), "Usage: jira link {key, to, linkType}");
        assert.equal(usage("unlink"), "Usage: jira unlink {key, to, linkType?}");
        assert.equal(usage("link_types"), "Usage: jira link_types {}");
        assert.equal(
            problem({ action: "link", key: "PROJ-1", to: "PROJ-2" }),
            "jira link needs linkType. Usage: jira link {key, to, linkType}",
        );
        assert.equal(
            problem({ action: "unlink", key: "PROJ-1" }),
            "jira unlink needs to. Usage: jira unlink {key, to, linkType?}",
        );
        assert.equal(
            problem({ action: "link", key: "PROJ-1", to: "PROJ-1", linkType: "Blocks" }),
            "jira link: key and to must be two different issues (both are PROJ-1)",
        );
        assert.equal(
            problem({ action: "link", key: "PROJ-1", to: "next", linkType: "Blocks" }),
            'jira link: to must be an issue key such as PROJ-123 (got "next")',
        );
        assert.match(
            problem({ action: "link", key: "PROJ-1", to: "PROJ-2", linkType: "  " }),
            /linkType must be text of 1 to 100/,
        );
        assert.equal(
            problem({ action: "link_types", key: "PROJ-1" }),
            "jira link_types does not use key. Usage: jira link_types {}",
        );
        assert.equal(
            problem({ action: "get", key: "PROJ-1", to: "PROJ-2" }),
            "jira get does not use to. Usage: jira get {key, include?, full?}",
        );
    });

    test("find_field needs two characters", () => {
        assert.match(problem({ action: "find_field", query: "a" }), /query must be at least 2 characters/);
        assert.deepEqual(parse({ action: "find_field", query: "story" }), { action: "find_field", query: "story" });
    });
});

describe("a search with commented", () => {
    const search = (commented: unknown, more: Record<string, unknown> = {}) => ({
        action: "search",
        jql: "project = PROJ",
        commented,
        ...more,
    });

    test("is a person and two days, either of which may be left out", () => {
        assert.deepEqual(parse(search({ by: "me", from: "2026-10-01", to: "2026-10-31" })), {
            action: "search",
            jql: "project = PROJ",
            limit: 20,
            page: undefined,
            include: [],
            commented: { by: "me", from: "2026-10-01", to: "2026-10-31" },
        });
        assert.deepEqual((parse(search({ by: " jdoe ", from: "2026-10-01" })) as { commented: unknown }).commented, {
            by: "jdoe",
            from: "2026-10-01",
        });
        assert.deepEqual((parse(search({ by: "me", to: "2026-10-31" })) as { commented: unknown }).commented, {
            by: "me",
            to: "2026-10-31",
        });
        assert.deepEqual((parse(search({ by: "me", from: null })) as { commented: unknown }).commented, { by: "me" });
    });

    test("is not in the call when it was not given, so a plain search is as it was", () => {
        assert.equal("commented" in parse({ action: "search", jql: "a" }), false);
        assert.equal("commented" in parse({ action: "search", jql: "a", commented: null }), false);
    });

    test("looks in the user's projects when the call has no JQL", () => {
        const call = parseCall({ action: "search", commented: { by: "me" } }, { projects: ["PROJ"] });
        assert.equal(call.action === "search" && call.jql, 'project in ("PROJ") ORDER BY updated DESC');
    });

    test("a mistake in it is named, with the shape it takes", () => {
        const shape = "Usage: commented {by, from?, to?}";
        assert.equal(
            problem(search("me")),
            `jira search: commented must be an object such as {"by": "me", "from": "2026-10-01"}. ${shape}`,
        );
        assert.equal(problem(search(["me"])), problem(search("me")));
        assert.equal(
            problem(search({ from: "2026-10-01" })).startsWith('jira search: commented.by must be "me"'),
            true,
        );
        for (const by of ["", "  ", 5, "x".repeat(129), "two\nlines"]) {
            assert.match(problem(search({ by })), /^jira search: commented\.by must be "me" or a person's account id/);
        }
        assert.equal(
            problem(search({ by: "me", since: "2026-10-01" })),
            `jira search: commented does not use since. ${shape}`,
        );
    });

    test("the days are real days, in order", () => {
        for (const day of ["2026-02-30", "2026-10-1", "10/01/2026", "yesterday", 20261001, "1999-12-31"]) {
            assert.match(
                problem(search({ by: "me", from: day })),
                /^jira search: commented\.from must be a day such as 2026-10-01 \(got /,
            );
            assert.match(
                problem(search({ by: "me", to: day })),
                /^jira search: commented\.to must be a day such as 2026-10-01 \(got /,
            );
        }
        assert.equal(
            problem(search({ by: "me", from: "2026-10-31", to: "2026-10-01" })),
            "jira search: commented.from (2026-10-31) is after commented.to (2026-10-01). Usage: commented {by, from?, to?}",
        );
        assert.doesNotThrow(() => parse(search({ by: "me", from: "2026-10-01", to: "2026-10-01" })));
    });

    test("takes no limit and no page, which a list of every match has no use for", () => {
        for (const more of [{ limit: 5 }, { page: "1" }]) {
            assert.match(
                problem(search({ by: "me" }, more)),
                /^jira search: limit and page do not apply with commented, which lists every issue the person commented on\./,
            );
        }
    });

    test("only a search takes it", () => {
        assert.equal(
            problem({ action: "comments", key: "PROJ-1", commented: { by: "me" } }),
            "jira comments does not use commented. Usage: jira comments {key, limit?, full?}",
        );
    });

    test("is in the schema as an object, with its three parts", () => {
        const property = (parameters as unknown as { properties: Record<string, Record<string, unknown>> }).properties
            .commented;
        assert.equal(property?.type, "object");
        assert.deepEqual(Object.keys((property?.properties ?? {}) as object), ["by", "from", "to"]);
        assert.deepEqual(property?.required, ["by"]);
    });
});

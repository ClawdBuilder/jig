// `search` with `commented` where ScriptRunner may be on the Jira: its `issueFunction in commented(...)` only makes the list of
// candidates short, and the comments are still checked one by one. The fake plays a Jira with it and one without, and reads
// the days `after` and `before` strictly (the day itself out) or loosely, because ScriptRunner's documentation does not say.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { addIssue, jane, matched, sam, sectionWith } from "./support/commented-fixtures.ts";
import { ok, setupHarness } from "./support/harness.ts";
import type { Harness } from "./support/harness.ts";

process.env.TZ = "Asia/Calcutta";

let h: Harness;
let datacenter: Harness;
before(async () => {
    h = await setupHarness("cloud");
    datacenter = await setupHarness("datacenter");
});
after(async () => {
    await h.close();
    await datacenter.close();
});
beforeEach(() => {
    h.reset();
    datacenter.reset();
});

const JANE = "5b10a2844c20165700ede21g";
const WINDOW = { by: "me", from: "2026-10-03", to: "2026-10-03" } as const;

/** Three days of October on the clock of Asia/Calcutta: the 3rd is 2 October 18:30 to 3 October 18:30 in UTC. */
function fixtures(harness: Harness): void {
    harness.jira.issues.clear();
    // Written on 2 October in UTC, but 01:30 on the 3rd for the person: in the window, and a strict `after 2026-10-02` loses it.
    addIssue(harness, "PROJ-71", [[jane(harness), "2026-10-02T20:00:00.000+0000"]]);
    // Written on 3 October in UTC, 15:30 for the person: in.
    addIssue(harness, "PROJ-72", [[jane(harness), "2026-10-03T10:00:00.000+0000"]]);
    // The 4th at 15:30 for the person: out, though a loose `before 2026-10-04` still lists it.
    addIssue(harness, "PROJ-73", [[jane(harness), "2026-10-04T10:00:00.000+0000"]]);
    // The 2nd for the person: out, though a loose `after 2026-10-02` still lists it.
    addIssue(harness, "PROJ-74", [[jane(harness), "2026-10-02T10:00:00.000+0000"]]);
    // Someone else's comment in the window, and my comment long before.
    addIssue(harness, "PROJ-75", [[sam(harness), "2026-10-03T10:00:00.000+0000"]]);
    addIssue(harness, "PROJ-76", [[jane(harness), "2026-09-01T10:00:00.000+0000"]]);
}

const issueFunctions = (harness: Harness): string[] =>
    harness.jira.requests
        .filter((request) => /^\/search/.test(request.path))
        .map((request) => request.query.jql ?? "")
        .filter((jql) => jql.includes("issueFunction"));

describe("ScriptRunner on the Jira", () => {
    test("its list is the candidates, with the days widened by two on each side, and the comments are still checked", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        const text = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(text), ["PROJ-71", "PROJ-72"]);
        assert.match(
            text,
            /^Issues commented on by me \(Jane Doe\), on 2026-10-03 \(days on your clock, both included\): 2 matches among 4 candidates checked\. Method: scriptrunner \(/,
        );
        assert.equal(
            issueFunctions(h)[0],
            `(project = PROJ) AND updated >= "2026-10-02" AND issueFunction in commented("by ${JANE} after 2026-10-01 before 2026-10-05")`,
        );
        assert.match(
            text,
            /\nCandidates came from: \(project = PROJ\) AND updated >= "2026-10-02" AND issueFunction in commented\(/,
        );
    });

    test("whether ScriptRunner takes the day itself in or out makes no difference to the matches", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        const strict = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        h.jira.scriptRunnerBounds = "inclusive";
        const loose = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(strict), ["PROJ-71", "PROJ-72"]);
        assert.deepEqual(matched(loose), ["PROJ-71", "PROJ-72"]);
        assert.match(loose, /among 4 candidates checked/);
    });

    test("an end that is left out is left out of the clause too", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        ok(await h.call({ action: "search", jql: "project = PROJ", commented: { by: "me", from: "2026-10-03" } }));
        ok(await h.call({ action: "search", jql: "project = PROJ", commented: { by: "me", to: "2026-10-03" } }));
        ok(await h.call({ action: "search", jql: "project = PROJ", commented: { by: "me" } }));
        assert.deepEqual(
            issueFunctions(h).map((jql) => /issueFunction.*$/.exec(jql)?.[0]),
            [
                `issueFunction in commented("by ${JANE} after 2026-10-01")`,
                `issueFunction in commented("by ${JANE} before 2026-10-05")`,
                `issueFunction in commented("by ${JANE}")`,
            ],
        );
        assert.doesNotMatch(issueFunctions(h)[1] ?? "", /updated >=/, "no first day, no condition on updated");
    });

    test("the caller's ORDER BY stays last, and its OR stays inside the parentheses", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        ok(
            await h.call({
                action: "search",
                jql: "project = PROJ OR assignee is EMPTY ORDER BY created",
                commented: { by: "me" },
            }),
        );
        assert.equal(
            issueFunctions(h)[0],
            `(project = PROJ OR assignee is EMPTY) AND issueFunction in commented("by ${JANE}") ORDER BY created`,
        );
    });

    test("on Data Center the clause names the user", async () => {
        fixtures(datacenter);
        datacenter.jira.scriptRunner = true;
        const text = ok(await datacenter.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.match(
            issueFunctions(datacenter).at(-1) ?? "",
            /issueFunction in commented\("by jdoe after 2026-10-01 before 2026-10-05"\)$/,
        );
        assert.match(text, /Method: scriptrunner/);
        assert.equal(datacenter.jira.sent("GET", /^\/search$/).length > 0, true);
    });

    test("the facts say which method found them", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        const result = await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW });
        ok(result);
        assert.deepEqual(h.jig.facts.get(result.id), [
            { candidates: 4, matched: 2, method: "scriptrunner", unread: 0 },
        ]);
    });
});

describe("a Jira without ScriptRunner", () => {
    test("auto tries once, falls back to reading, and says why; a second search does not try again", async () => {
        fixtures(h);
        const first = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(first), ["PROJ-71", "PROJ-72"]);
        assert.match(
            first,
            /Method: read \(ScriptRunner's commented\(\) is not on this Jira; every candidate's comments were read\)\./,
        );
        assert.equal(issueFunctions(h).length, 1, "the one try");
        const second = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(second), ["PROJ-71", "PROJ-72"]);
        assert.match(
            second,
            /Method: read \(ScriptRunner's commented\(\) is not on this Jira \(found out earlier in this session\); every/,
        );
        assert.equal(issueFunctions(h).length, 1, "the second search did not try");
    });

    test("the plain candidates are the same without it: the caller's JQL and a day of slack on updated", async () => {
        fixtures(h);
        ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        const queries = h.jira.sent("GET", "/search/jql").map((request) => request.query.jql);
        assert.deepEqual(queries, [
            `(project = PROJ) AND updated >= "2026-10-02" AND issueFunction in commented("by ${JANE} after 2026-10-01 before 2026-10-05")`,
            '(project = PROJ) AND updated >= "2026-10-02"',
        ]);
    });

    test("on Data Center the try is made on the offset search, and also falls back", async () => {
        fixtures(datacenter);
        const text = ok(await datacenter.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(text), ["PROJ-71", "PROJ-72"]);
        assert.match(text, /Method: read \(ScriptRunner's commented\(\) is not on this Jira;/);
    });

    test("read never tries, even where it is installed", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        h.configure(sectionWith({ commentSearch: "read" }));
        const text = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(text), ["PROJ-71", "PROJ-72"]);
        assert.equal(issueFunctions(h).length, 0);
        assert.match(text, /Method: read \(every candidate's comments were read\)\./);
    });

    test("scriptrunner does not fall back: it says the function is missing and names the setting", async () => {
        fixtures(h);
        h.configure(sectionWith({ commentSearch: "scriptrunner" }));
        const result = await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW });
        assert.match(
            result.error?.message ?? "",
            /^jira search: commentSearch is "scriptrunner", but this Jira does not have its commented\(\) function \(Jira said 400 to GET \/search\/jql: Field 'issueFunction' does not exist.* Use commentSearch "auto" or "read"$/,
        );
        assert.equal(h.jira.sent("GET", "/search/jql").length, 1);
    });

    test("scriptrunner works where it is installed", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        h.configure(sectionWith({ commentSearch: "scriptrunner" }));
        const text = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(text), ["PROJ-71", "PROJ-72"]);
    });
});

describe("when Jira refuses the ScriptRunner query for another reason", () => {
    test("auto reads this time, says what Jira said, and tries again next time", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        h.jira.misbehave({
            match: (request) => (request.query.jql ?? "").includes("issueFunction"),
            apply: false,
            status: 400,
            afterMs: 0,
        });
        const first = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.deepEqual(matched(first), ["PROJ-71", "PROJ-72"]);
        assert.match(
            first,
            /Method: read \(Jira refused ScriptRunner's query \(Jira said 400 to GET \/search\/jql: Service Unavailable\);/,
        );
        const second = ok(await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW }));
        assert.match(second, /Method: scriptrunner/, "it was not remembered as missing");
    });

    test("a failure that is not a refusal is a failure of the search", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        h.jira.misbehave({
            match: (request) => (request.query.jql ?? "").includes("issueFunction"),
            apply: false,
            status: 503,
            afterMs: 0,
        });
        const result = await h.call({ action: "search", jql: "project = PROJ", commented: WINDOW });
        assert.match(result.error?.message ?? "", /^Jira said 503 to GET \/search\/jql/);
    });

    test("a person ScriptRunner's query cannot carry is read in auto and refused in scriptrunner", async () => {
        fixtures(h);
        h.jira.scriptRunner = true;
        const auto = ok(await h.call({ action: "search", jql: "project = PROJ", commented: { by: "Jane Doe" } }));
        assert.match(auto, /Method: read \(the person cannot be written in ScriptRunner's query;/);
        assert.equal(issueFunctions(h).length, 0);
        h.configure(sectionWith({ commentSearch: "scriptrunner" }));
        const strict = await h.call({ action: "search", jql: "project = PROJ", commented: { by: "Jane Doe" } });
        assert.match(
            strict.error?.message ?? "",
            /^jira search: commentSearch is "scriptrunner", but this person cannot be written/,
        );
    });
});

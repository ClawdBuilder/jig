// `search` with `commented`, against a fake Jira on this machine: which issues a person commented on in some days. The fake
// has no such query, so the tool lists candidates and reads their comments. The clock is set to a zone that is not UTC, so
// the edges of a day are tested where the person's midnight and Jira's stamps disagree.
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { COMMENT_READS_AT_ONCE, MAX_CANDIDATES } from "../src/commented.ts";
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
    // These tests are about reading the comments. ScriptRunner has a file of its own.
    h.configure(section());
    datacenter.configure(section());
});

/** The `jira` section: the default one, set to read the comments of every candidate. */
const section = (more: Record<string, unknown> = {}): Record<string, unknown> =>
    sectionWith({ commentSearch: "read", ...more });

const search = (harness: Harness, commented: Record<string, unknown>, more: Record<string, unknown> = {}) =>
    harness.call({ action: "search", jql: "project = PROJ", commented, ...more });

describe("what a search by who commented returns", () => {
    test("the issues the person commented on in the days, with each comment's id and date and no text", async () => {
        const text = ok(
            await h.call({
                action: "search",
                jql: "project = PROJ ORDER BY updated DESC",
                commented: { by: "me", from: "2026-10-01", to: "2026-10-31" },
            }),
        );
        assert.equal(
            text,
            [
                "Issues commented on by me (Jane Doe), 2026-10-01 to 2026-10-31 (days on your clock, both included): " +
                    "1 match among 2 candidates checked. Method: read (every candidate's comments were read).",
                'Candidates came from: (project = PROJ) AND updated >= "2026-09-30" ORDER BY updated DESC',
                "PROJ-1 | In Progress | Fix login crash on Safari",
                "    #10002 2026-10-03 10:00 +0000",
            ].join("\n"),
        );
        assert.doesNotMatch(text, /Fix is in/, "the text of a comment is not in the result");
    });

    test("the tool asks who is signed in, then lists candidates with the comments of each, then reads nothing more", async () => {
        ok(await search(h, { by: "me", from: "2026-10-01" }));
        assert.deepEqual(
            h.jira.requests.map((request) => `${request.method} ${request.path}`),
            ["GET /myself", "GET /search/jql"],
            "the threads came with the candidates, so no thread is read",
        );
        assert.deepEqual(h.jira.requests[1]?.query, {
            jql: '(project = PROJ) AND updated >= "2026-09-30"',
            fields: "summary,status,comment",
            maxResults: "50",
        });
    });

    test("the call's record carries the number of candidates, the matches, the method and the unread", async () => {
        const result = await search(h, { by: "me" });
        ok(result);
        assert.deepEqual(h.jig.facts.get(result.id), [{ candidates: 2, matched: 1, method: "read", unread: 0 }]);
    });

    test("with no match it says so, and a person given by name is told how people are matched", async () => {
        const mine = ok(await search(h, { by: "me", from: "2026-10-01", to: "2026-10-02" }));
        assert.match(mine, /: 0 matches among 2 candidates checked\./);
        assert.doesNotMatch(mine, /display name/);
        const named = ok(await search(h, { by: "Sam Lee" }));
        assert.match(named, /\n.*never by display name; check that commented\.by is one of those\.$/);
    });

    test("a person other than me, by account id in any case", async () => {
        const text = ok(await search(h, { by: "712020:6C21D3A0-1111-4222-8333-944455556666" }));
        assert.match(text, /^Issues commented on by 712020:6C21D3A0-/);
        assert.deepEqual(matched(text), ["PROJ-1"]);
        assert.match(text, /#10001 2026-10-02 08:00 \+0000\n {4}#10003 2026-10-05 11:00 \+0000$/);
        assert.equal(h.jira.sent("GET", "/myself").length, 0, "a named person needs no look-up of who is signed in");
    });

    test("extra fields are shown under each match, and the JQL note is added", async () => {
        const text = ok(
            await h.call({
                action: "search",
                jql: "labels != done",
                include: ["customfield_10016"],
                commented: { by: "me" },
            }),
        );
        assert.match(
            text,
            /\nPROJ-1 \| In Progress \| Fix login crash on Safari\n {4}Story Points \(customfield_10016\): 5\n/,
        );
        assert.match(text, /\nNote: labels != done also drops the issues that have no labels\./);
        assert.equal(h.jira.sent("GET", "/search/jql")[0]?.query.fields, "summary,status,customfield_10016,comment");
    });

    test("more than ten comments of one issue, and more than a hundred matching issues, are counted", async () => {
        addIssue(
            h,
            "PROJ-20",
            Array.from({ length: 12 }, (_, i) => [jane(h), `2026-10-02T0${i % 10}:00:00.000+0000`] as const),
        );
        for (let n = 0; n < 100; n++) addIssue(h, `PROJ-${300 + n}`, [[jane(h), "2026-10-02T09:00:00.000+0000"]]);
        const text = ok(await search(h, { by: "me" }));
        assert.match(text, /: 102 matches among 103 candidates checked\./);
        assert.match(text, /\nPROJ-20 \| .*\n( {4}#\d+ .*\n){10} {4}\.\.\. and 2 more comments\n/);
        assert.match(
            text,
            /\n\.\.\. and 2 more matches; narrow commented\.from, commented\.to or the JQL to see them$/,
        );
        assert.equal(matched(text).length, 100);
    });
});

describe("the days", () => {
    // 1 to 3 October on the clock of Asia/Calcutta (UTC+5:30), which is set at the top of this file.
    const EDGES: Record<string, string> = {
        "PROJ-11": "2026-10-01T00:00:00.000+0530",
        "PROJ-12": "2026-09-30T23:59:59.999+0530",
        "PROJ-13": "2026-10-03T23:59:59.999+0530",
        "PROJ-14": "2026-10-04T00:00:00.000+0530",
        "PROJ-15": "2026-09-30T19:00:00.000+0000",
        "PROJ-16": "2026-10-03T20:00:00.000+0000",
    };

    test("a day is midnight to midnight on the person's clock, and the first and last day are both in", async () => {
        h.jira.issues.clear();
        for (const [key, created] of Object.entries(EDGES)) addIssue(h, key, [[jane(h), created]]);
        const text = ok(await search(h, { by: "me", from: "2026-10-01", to: "2026-10-03" }));
        assert.deepEqual(matched(text), [
            "PROJ-11", // the first moment of 1 October
            "PROJ-13", // the last moment of 3 October
            "PROJ-15", // 30 September in UTC, but 00:30 on 1 October for the person
        ]);
        assert.match(text, /: 3 matches among 6 candidates checked\./);
    });

    test("an issue updated after the window is still a match if the comment is inside it", async () => {
        h.jira.issues.clear();
        addIssue(h, "PROJ-30", [[jane(h), "2026-10-02T09:00:00.000+0000"]], {
            updated: "2026-11-15T09:00:00.000+0000",
        });
        const text = ok(await search(h, { by: "me", from: "2026-10-01", to: "2026-10-03" }));
        assert.deepEqual(matched(text), ["PROJ-30"]);
        for (const request of h.jira.sent("GET", "/search/jql")) {
            assert.doesNotMatch(request.query.jql ?? "", /updated\s*<|before/, "no upper bound on updated");
        }
    });

    test("a day of slack on updated keeps an issue whose last change is its comment, early in the first day", async () => {
        h.jira.issues.clear();
        // 01:30 on 3 October for the person, but 2 October in the UTC that this fake Jira reads `updated >= "..."` in.
        const created = "2026-10-02T20:00:00.000+0000";
        addIssue(h, "PROJ-33", [[jane(h), created]], { updated: created });
        const text = ok(await search(h, { by: "me", from: "2026-10-03", to: "2026-10-03" }));
        assert.deepEqual(matched(text), ["PROJ-33"]);
        assert.equal(h.jira.sent("GET", "/search/jql")[0]?.query.jql, '(project = PROJ) AND updated >= "2026-10-02"');
    });

    test("an issue not updated since a day before the first day cannot hold a comment in the window", async () => {
        h.jira.issues.clear();
        addIssue(h, "PROJ-31", [[jane(h), "2026-09-01T09:00:00.000+0000"]], {
            updated: "2026-09-01T09:00:00.000+0000",
        });
        addIssue(h, "PROJ-32", [[jane(h), "2026-10-02T09:00:00.000+0000"]], {
            updated: "2026-10-02T09:00:00.000+0000",
        });
        const text = ok(await search(h, { by: "me", from: "2026-10-01", to: "2026-10-03" }));
        assert.deepEqual(matched(text), ["PROJ-32"]);
        assert.match(text, /among 1 candidate checked\./, "the older issue was never a candidate");
    });

    test("an end that is left out is open: from alone, to alone, and neither", async () => {
        h.jira.issues.clear();
        for (const [key, created] of Object.entries(EDGES)) addIssue(h, key, [[jane(h), created]]);
        const from = ok(await search(h, { by: "me", from: "2026-10-04" }));
        assert.deepEqual(matched(from), ["PROJ-14", "PROJ-16"]);
        assert.match(from, /, since 2026-10-04 \(days/);
        const to = ok(await search(h, { by: "me", to: "2026-09-30" }));
        assert.deepEqual(matched(to), ["PROJ-12"]);
        assert.match(to, /, up to 2026-09-30 \(days/);
        const any = ok(await search(h, { by: "me" }));
        assert.equal(matched(any).length, 6);
        assert.match(any, /, on any day \(days/);
        const one = ok(await search(h, { by: "me", from: "2026-10-04", to: "2026-10-04" }));
        assert.match(one, /, on 2026-10-04 \(days/);
    });

    test("with no first day there is no condition on updated at all", async () => {
        ok(
            await h.call({
                action: "search",
                jql: "project = PROJ ORDER BY created",
                commented: { by: "me", to: "2026-10-03" },
            }),
        );
        assert.equal(h.jira.sent("GET", "/search/jql")[0]?.query.jql, "project = PROJ ORDER BY created");
    });

    test("the caller's JQL goes in parentheses and its ORDER BY stays last; no JQL means the user's projects", async () => {
        ok(
            await h.call({
                action: "search",
                jql: "project = PROJ OR assignee = currentUser() ORDER BY created DESC",
                commented: { by: "me", from: "2026-10-01" },
            }),
        );
        assert.equal(
            h.jira.sent("GET", "/search/jql")[0]?.query.jql,
            '(project = PROJ OR assignee = currentUser()) AND updated >= "2026-09-30" ORDER BY created DESC',
        );
        h.reset();
        h.configure(section({ projects: ["PROJ"] }));
        ok(await h.call({ action: "search", commented: { by: "me", from: "2026-10-01" } }));
        assert.equal(
            h.jira.sent("GET", "/search/jql")[0]?.query.jql,
            '(project in ("PROJ")) AND updated >= "2026-09-30" ORDER BY updated DESC',
        );
    });
});

describe("reading the comments", () => {
    test("a thread of more than one page is read whole, page after page", async () => {
        h.jira.issues.clear();
        const others = Array.from({ length: 229 }, () => [sam(h), "2026-10-02T09:00:00.000+0000"] as const);
        addIssue(h, "PROJ-40", [...others.slice(0, 5), [jane(h), "2026-10-02T10:00:00.000+0000"], ...others.slice(5)]);
        addIssue(h, "PROJ-41", [...others, [jane(h), "2026-10-02T11:00:00.000+0000"]]);
        h.jira.inlineComments = 2;
        const text = ok(await search(h, { by: "me", from: "2026-10-01", to: "2026-10-03" }));
        assert.deepEqual(matched(text), ["PROJ-40", "PROJ-41"]);
        assert.match(text, /PROJ-40 \| .*\n {4}#40006 2026-10-02 10:00 \+0000\nPROJ-41/);
        assert.match(text, /PROJ-41 \| .*\n {4}#41230 2026-10-02 11:00 \+0000$/);
        const pages = h.jira.sent("GET", "/issue/PROJ-41/comment").map((request) => request.query.startAt);
        assert.deepEqual(pages, ["0", "100", "200"]);
    });

    test("a Jira that cuts pages shorter than asked is followed until the end", async () => {
        h.jira.issues.clear();
        const others = Array.from({ length: 99 }, () => [sam(h), "2026-10-02T09:00:00.000+0000"] as const);
        addIssue(h, "PROJ-42", [...others, [jane(h), "2026-10-02T11:00:00.000+0000"]]);
        h.jira.embedComments = false;
        h.jira.commentPageCap = 40;
        const text = ok(await search(h, { by: "me", from: "2026-10-01", to: "2026-10-03" }));
        assert.deepEqual(matched(text), ["PROJ-42"]);
        assert.deepEqual(
            h.jira.sent("GET", "/issue/PROJ-42/comment").map((request) => request.query.startAt),
            ["0", "40", "80"],
        );
    });

    test("a thread Jira sent in part is read, and one it sent whole is not", async () => {
        h.jira.inlineComments = 2;
        const text = ok(await search(h, { by: "me" }));
        assert.deepEqual(matched(text), ["PROJ-1"]);
        assert.deepEqual(
            h.jira.sent("GET", /\/comment$/).map((request) => request.path),
            ["/issue/PROJ-1/comment"],
            "PROJ-1 has 3 comments and 2 came with it; PROJ-2 has none, and that came whole",
        );
    });

    test("a Jira that sends no comments with a search gets one read per candidate", async () => {
        h.jira.embedComments = false;
        const text = ok(await search(h, { by: "me" }));
        assert.deepEqual(matched(text), ["PROJ-1"]);
        assert.deepEqual(
            h.jira
                .sent("GET", /\/comment$/)
                .map((request) => request.path)
                .sort(),
            ["/issue/PROJ-1/comment", "/issue/PROJ-2/comment"],
        );
    });

    test("an answer too large to read is asked for again without the comments, which are then read", async () => {
        h.jira.misbehave({
            match: (request) => request.path === "/search/jql" && (request.query.fields ?? "").includes("comment"),
            html: "x".repeat(9 * 1024 * 1024),
            afterMs: 0,
        });
        const text = ok(await search(h, { by: "me" }));
        assert.deepEqual(matched(text), ["PROJ-1"]);
        assert.deepEqual(
            h.jira.sent("GET", "/search/jql").map((request) => request.query.fields),
            ["summary,status,comment", "summary,status"],
        );
        assert.equal(h.jira.sent("GET", /\/comment$/).length, 2);
    });

    test("a few reads at a time", async () => {
        h.jira.issues.clear();
        for (let n = 0; n < 12; n++) addIssue(h, `PROJ-${50 + n}`, [[jane(h), "2026-10-02T09:00:00.000+0000"]]);
        h.jira.embedComments = false;
        h.jira.commentDelayMs = 60;
        const text = ok(await search(h, { by: "me" }));
        assert.equal(matched(text).length, 12);
        assert.equal(h.jira.sent("GET", /\/comment$/).length, 12);
        assert.equal(h.jira.peakCommentReads, COMMENT_READS_AT_ONCE);
        assert.equal(COMMENT_READS_AT_ONCE, 4);
    });
});

describe("when a read fails", () => {
    function candidates(count: number): void {
        h.jira.issues.clear();
        for (let n = 0; n < count; n++) addIssue(h, `PROJ-${60 + n}`, [[jane(h), "2026-10-02T09:00:00.000+0000"]]);
        h.jira.embedComments = false;
    }
    const failing = (key: string) => ({
        match: (request: { path: string }) => request.path === `/issue/${key}/comment`,
        status: 500,
        apply: false,
        afterMs: 0,
    });

    test("one issue is named in the result, and the others are still checked", async () => {
        candidates(6);
        h.jira.misbehave(failing("PROJ-62"));
        const result = await search(h, { by: "me" });
        const text = ok(result);
        assert.deepEqual(matched(text), ["PROJ-60", "PROJ-61", "PROJ-63", "PROJ-64", "PROJ-65"]);
        assert.match(text, /: 5 matches among 5 candidates checked\./);
        assert.match(
            text,
            /\nCould not read the comments of 1 issue, so it is not counted: PROJ-62 \(Jira said 500 to GET \/issue\/PROJ-62\/comment: Service Unavailable\)\n/,
        );
        assert.deepEqual(h.jig.facts.get(result.id), [{ candidates: 6, matched: 5, method: "read", unread: 1 }]);
    });

    test("two failures out of two are still a result, with both named", async () => {
        candidates(2);
        h.jira.misbehave(failing("PROJ-60"));
        h.jira.misbehave(failing("PROJ-61"));
        const text = ok(await search(h, { by: "me" }));
        assert.match(text, /: 0 matches among 0 candidates checked\./);
        assert.match(
            text,
            /\nCould not read the comments of 2 issues, so they are not counted: PROJ-60 \(.*\); PROJ-61 \(/,
        );
    });

    test("when most fail the search stops, and says so", async () => {
        candidates(30);
        for (let n = 0; n < 30; n++) h.jira.misbehave(failing(`PROJ-${60 + n}`));
        const result = await search(h, { by: "me" });
        assert.match(
            result.error?.message ?? "",
            /^jira search: the comments of \d+ of \d+ issues could not be read, so the search stopped \(PROJ-60: Jira said 500/,
        );
        assert.ok(h.jira.sent("GET", /\/comment$/).length < 30, "it did not go on through every issue");
    });

    test("a few failures among many successes do not stop it", async () => {
        candidates(12);
        for (const key of ["PROJ-60", "PROJ-65", "PROJ-70"]) h.jira.misbehave(failing(key));
        const text = ok(await search(h, { by: "me" }));
        assert.match(text, /: 9 matches among 9 candidates checked\./);
        assert.match(text, /Could not read the comments of 3 issues/);
    });

    test("cancelling stops the reads, and no more are sent", async () => {
        candidates(20);
        h.jira.commentDelayMs = 20;
        const controller = new AbortController();
        h.jira.misbehave({
            match: (request) => /\/comment$/.test(request.path),
            afterMs: 0,
            effect: () => controller.abort(),
        });
        const result = await h.call(
            { action: "search", jql: "project = PROJ", commented: { by: "me" } },
            { signal: controller.signal },
        );
        assert.equal(result.error?.message, "jira search: cancelled before every comment was read");
        assert.ok(h.jira.sent("GET", /\/comment$/).length <= COMMENT_READS_AT_ONCE);
    });

    test("cancelling while the candidates are listed stops that too", async () => {
        const controller = new AbortController();
        h.jira.misbehave({
            match: (request) => request.path === "/myself",
            afterMs: 0,
            effect: () => controller.abort(),
        });
        const result = await h.call(
            { action: "search", jql: "project = PROJ", commented: { by: "me" } },
            { signal: controller.signal },
        );
        assert.ok(result.error, "the call did not work");
        assert.equal(h.jira.sent("GET", /^\/search/).length, 0);
    });

    test("a JQL that Jira refuses fails the whole search with Jira's own words", async () => {
        h.jira.unknownFields = ["PR Link"];
        const result = await h.call({
            action: "search",
            jql: 'project = PROJ AND "PR Link" is not EMPTY',
            commented: { by: "me" },
        });
        assert.match(
            result.error?.message ?? "",
            /^Jira said 400 to GET \/search\/jql: Field 'PR Link' does not exist/,
        );
        assert.match(result.error?.message ?? "", /Did you mean Pull Request Link \(customfield_10500\)\?$/);
    });
});

describe("how many issues are checked", () => {
    function many(harness: Harness, total: number): void {
        for (let n = harness.jira.issues.size; n < total; n++) {
            addIssue(harness, `PROJ-${1000 + n}`, [[sam(harness), "2026-10-02T09:00:00.000+0000"]]);
        }
    }

    test("500 candidates are checked", async () => {
        many(h, MAX_CANDIDATES);
        assert.equal(h.jira.issues.size, 500);
        const text = ok(await search(h, { by: "me" }));
        assert.match(text, /: 1 match among 500 candidates checked\./);
        assert.equal(h.jira.sent("GET", "/search/jql").length, 10, "ten pages of fifty");
    });

    test("501 are refused, with how to narrow the query, before any comment is read", async () => {
        many(h, MAX_CANDIDATES + 1);
        h.jira.embedComments = false;
        const result = await search(h, { by: "me" }, {});
        assert.match(
            result.blocked ?? result.error?.message ?? "",
            /^jira search: More than 500 issues match project = PROJ, which is too many to check comment by comment \(the most is 500\)\. Narrow the JQL \(one project, component, status or assignee\), or give commented\.from: only issues updated since that day are checked\.$/,
        );
        assert.equal(h.jira.sent("GET", /\/comment$/).length, 0);
    });

    test("with a first day already given, it says to move it later", async () => {
        many(h, MAX_CANDIDATES + 1);
        const result = await search(h, { by: "me", from: "2026-01-01" });
        assert.match(
            result.error?.message ?? "",
            /, or move commented\.from later: only issues updated since that day/,
        );
    });

    test("Data Center counts the matches, so it refuses on the first page", async () => {
        many(datacenter, MAX_CANDIDATES + 1);
        const result = await search(datacenter, { by: "me" });
        assert.match(result.error?.message ?? "", /^jira search: 501 issues match project = PROJ, which is too many/);
        assert.deepEqual(
            datacenter.jira.requests.map((request) => request.path),
            ["/myself", "/search/jql", "/search"],
            "one page of the search, and no more",
        );
    });
});

describe("who me is", () => {
    test("a site that does not answer /myself needs jira.me, and the message says so", async () => {
        h.jira.myselfStatus = 404;
        const result = await search(h, { by: "me" });
        assert.equal(
            result.error?.message,
            'jira search: commented.by "me" needs to know who is signed in, and Jira answered 404 to GET /myself. ' +
                'Set "me" in the jira section of jig.json to your account id (Jira Cloud) or user name (Data Center), ' +
                "or give the person in commented.by",
        );
        assert.deepEqual(
            h.jira.requests.map((request) => request.path),
            ["/myself"],
            "no search was made",
        );
        assert.ok(result.error instanceof TypeError, "a setup mistake blocks without asking, like the other messages");
    });

    test("jira.me names the account, and the result says me", async () => {
        h.jira.myselfStatus = 403;
        h.configure(section({ me: jane(h).accountId }));
        const result = await search(h, { by: "me" });
        const text = ok(result);
        assert.match(text, /^Issues commented on by me, on any day/);
        assert.deepEqual(matched(text), ["PROJ-1"]);
    });

    test("when /myself answers, jira.me is not needed, and what it answers wins", async () => {
        h.configure(section({ me: sam(h).accountId }));
        const text = ok(await search(h, { by: "me" }));
        assert.match(text, /^Issues commented on by me \(Jane Doe\)/);
        assert.match(text, /#10002 /);
        assert.doesNotMatch(text, /#10001 /);
    });

    test("on Data Center a user name, a key and an email address each find the person", async () => {
        const dc = datacenter;
        for (const by of ["slee", "SLee", "JIRAUSER10002", "sam.lee@example.test"]) {
            const text = ok(await search(dc, { by }));
            assert.deepEqual(matched(text), ["PROJ-1"], by);
            assert.match(text, /#10001 2026-10-02 08:00 \+0000\n {4}#10003 /, by);
        }
        const me = ok(await search(dc, { by: "me" }));
        assert.match(me, /^Issues commented on by me \(Jane Doe\)/);
        assert.match(me, /#10002 /);
    });

    test("on Data Center, jira.me is a user name", async () => {
        datacenter.jira.myselfStatus = 404;
        datacenter.configure(section({ me: "jdoe" }));
        const text = ok(await search(datacenter, { by: "me" }));
        assert.deepEqual(matched(text), ["PROJ-1"]);
        assert.match(text, /#10002 /);
    });
});

describe("the JQL and the filter together", () => {
    test("limit and page are refused with commented, before anything is sent", async () => {
        const result = await search(h, { by: "me" }, { limit: 5 });
        assert.match(
            result.blocked ?? result.error?.message ?? "",
            /^jira search: limit and page do not apply with commented/,
        );
        assert.equal(h.jira.requests.length, 0);
    });

    test("no note when the JQL already says what an empty field does", async () => {
        const text = ok(
            await h.call({
                action: "search",
                jql: "(labels is EMPTY OR labels != done)",
                commented: { by: "me" },
            }),
        );
        assert.doesNotMatch(text, /Note:/);
    });
});

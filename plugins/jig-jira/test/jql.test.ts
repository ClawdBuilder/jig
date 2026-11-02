// The JQL helpers: the traps a query holds that a note points out. Pure functions, no Jira.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { andClauses, commentedClause, jqlNotes, maskQuoted, splitOrder, updatedSince } from "../src/jql.ts";

describe("maskQuoted", () => {
    test("blanks the text of a string and keeps the quotes and the length", () => {
        assert.equal(maskQuoted('summary ~ "labels != x" AND a = b'), `summary ~ "${" ".repeat(11)}" AND a = b`);
        assert.equal(maskQuoted("a = 'x y' OR b = 'z'"), "a = '   ' OR b = ' '");
    });

    test("an escaped quote does not end the string", () => {
        const jql = 'summary ~ "say \\"labels != x\\" now" AND b = c';
        assert.equal(maskQuoted(jql).length, jql.length);
        assert.doesNotMatch(maskQuoted(jql), /labels/);
        assert.match(maskQuoted(jql), /AND b = c$/);
    });

    test("a string that never closes is blanked to the end", () => {
        assert.equal(maskQuoted('a = "open'), 'a = "    ');
    });
});

describe("jqlNotes", () => {
    test("labels != x says that issues with no labels go too, and what to write instead", () => {
        assert.deepEqual(jqlNotes("project = PROJ AND labels != reviewed"), [
            "Note: labels != reviewed also drops the issues that have no labels. " +
                "To keep them, use (labels is EMPTY OR labels != reviewed).",
        ]);
    });

    test("a quoted value, and the field written in any case", () => {
        assert.deepEqual(jqlNotes('LABELS!="needs review" ORDER BY created'), [
            'Note: LABELS != "needs review" also drops the issues that have no labels. ' +
                'To keep them, use (LABELS is EMPTY OR LABELS != "needs review").',
        ]);
    });

    test("labels not in (...) is the same trap", () => {
        assert.deepEqual(jqlNotes('labels not in ("a b", c) AND status = Open'), [
            'Note: labels not in ("a b", c) also drops the issues that have no labels. ' +
                'To keep them, use (labels is EMPTY OR labels not in ("a b", c)).',
        ]);
    });

    test("component and fixVersion have the same trap", () => {
        assert.deepEqual(jqlNotes("component != Web AND fixVersion not in (1.2, 1.3)"), [
            "Note: component != Web also drops the issues that have no component. " +
                "To keep them, use (component is EMPTY OR component != Web).",
            "Note: fixVersion not in (1.2, 1.3) also drops the issues that have no fix version. " +
                "To keep them, use (fixVersion is EMPTY OR fixVersion not in (1.2, 1.3)).",
        ]);
    });

    test("no note when the query already says what happens to an empty field", () => {
        assert.deepEqual(jqlNotes("(labels is EMPTY OR labels != reviewed)"), []);
        assert.deepEqual(jqlNotes("labels != reviewed AND labels is not EMPTY"), []);
        assert.deepEqual(jqlNotes("labels not in (a) AND labels is null"), []);
        assert.equal(jqlNotes("component != Web AND labels is EMPTY").length, 1, "only the field it names");
    });

    test("no note for a comparison that keeps empty fields out anyway", () => {
        assert.deepEqual(jqlNotes("labels = reviewed AND labels in (a, b) AND status != Done"), []);
    });

    test("a word inside a string is not a clause", () => {
        assert.deepEqual(jqlNotes("summary ~ \"labels != x\" AND description ~ 'component not in (a)'"), []);
    });

    test("the same clause twice is noted once", () => {
        assert.equal(jqlNotes("labels != a OR labels != a").length, 1);
        assert.equal(jqlNotes("labels != a OR labels != b").length, 2);
    });
});

describe("splitOrder", () => {
    test("cuts at the ORDER BY, in any case and over any space", () => {
        assert.deepEqual(splitOrder("project = PROJ ORDER BY updated DESC"), {
            where: "project = PROJ",
            order: "ORDER BY updated DESC",
        });
        assert.deepEqual(splitOrder("a = 1 order   by created, key"), {
            where: "a = 1",
            order: "order   by created, key",
        });
        assert.deepEqual(splitOrder("(a = 1)ORDER BY key"), { where: "(a = 1)", order: "ORDER BY key" });
    });

    test("a query with no ORDER BY, or only one, or one inside a string", () => {
        assert.deepEqual(splitOrder("project = PROJ"), { where: "project = PROJ", order: "" });
        assert.deepEqual(splitOrder("ORDER BY key"), { where: "", order: "ORDER BY key" });
        const quoted = 'summary ~ "order by hand" AND status = Open';
        assert.deepEqual(splitOrder(quoted), { where: quoted, order: "" });
        assert.deepEqual(splitOrder('summary ~ "order by" ORDER BY key'), {
            where: 'summary ~ "order by"',
            order: "ORDER BY key",
        });
    });

    test("a word that only ends in order is not an ORDER BY", () => {
        assert.deepEqual(splitOrder("reorder by = 1"), { where: "reorder by = 1", order: "" });
    });
});

describe("andClauses", () => {
    test("the query goes in parentheses, so an OR cannot swallow the condition, and the ORDER BY stays last", () => {
        assert.equal(
            andClauses("project = PROJ OR assignee = currentUser() ORDER BY updated DESC", [
                updatedSince("2026-09-29"),
            ]),
            '(project = PROJ OR assignee = currentUser()) AND updated >= "2026-09-29" ORDER BY updated DESC',
        );
    });

    test("without an ORDER BY none is added", () => {
        assert.equal(
            andClauses("project = PROJ", [updatedSince("2026-09-29"), 'issueFunction in commented("by jdoe")']),
            '(project = PROJ) AND updated >= "2026-09-29" AND issueFunction in commented("by jdoe")',
        );
    });

    test("a query that is only an ORDER BY is just the conditions, then the ORDER BY", () => {
        assert.equal(andClauses("ORDER BY key", [updatedSince("2026-09-29")]), 'updated >= "2026-09-29" ORDER BY key');
    });

    test("with nothing to add the query is as it was", () => {
        assert.equal(andClauses("project = PROJ ORDER BY key", []), "project = PROJ ORDER BY key");
    });
});

describe("commentedClause", () => {
    test("by a user, after and before days that are given", () => {
        assert.equal(
            commentedClause("jdoe", "2026-09-29", "2026-10-04"),
            'issueFunction in commented("by jdoe after 2026-09-29 before 2026-10-04")',
        );
        assert.equal(
            commentedClause("jdoe", "2026-09-29", undefined),
            'issueFunction in commented("by jdoe after 2026-09-29")',
        );
        assert.equal(
            commentedClause("jdoe", undefined, "2026-10-04"),
            'issueFunction in commented("by jdoe before 2026-10-04")',
        );
        assert.equal(commentedClause("jdoe", undefined, undefined), 'issueFunction in commented("by jdoe")');
    });

    test("an account id and an email address fit; anything that could end the string or split the query does not", () => {
        assert.ok(commentedClause("712020:6c21d3a0-1111-4222-8333-944455556666", undefined, undefined));
        assert.ok(commentedClause("jane.doe@example.test", undefined, undefined));
        for (const user of ['jd"oe', "j doe", "jd)oe", "", "x".repeat(129), "jd\noe"]) {
            assert.equal(commentedClause(user, undefined, undefined), undefined, JSON.stringify(user));
        }
    });
});

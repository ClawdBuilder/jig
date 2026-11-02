// The JQL helpers: the traps a query holds that a note points out. Pure functions, no Jira.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jqlNotes, maskQuoted } from "../src/jql.ts";

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

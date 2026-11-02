// Reading and building JQL text: what a query says that its writer may not mean. Pure functions, no requests.

/**
 * The query with the text inside quotes blanked out (the quotes stay), so a pattern never matches a word that is only
 * part of a string. The length is the same, so a position in the result is a position in the query.
 */
export function maskQuoted(jql: string): string {
    let quote = "";
    let out = "";
    for (let i = 0; i < jql.length; i++) {
        const char = jql.charAt(i);
        if (quote === "") {
            out += char;
            if (char === '"' || char === "'") quote = char;
        } else if (char === "\\" && i + 1 < jql.length) {
            out += "  ";
            i++;
        } else {
            out += char === quote ? char : " ";
            if (char === quote) quote = "";
        }
    }
    return out;
}

/** A field that can hold nothing, and what "nothing" is called in a note. */
const OPTIONAL_FIELDS: ReadonlyArray<{ name: RegExp; none: string }> = [
    { name: /labels/, none: "no labels" },
    { name: /components?/, none: "no component" },
    { name: /fixVersions?/, none: "no fix version" },
];

/** What follows `from` in the query as the operand of a comparison: a quoted string, or a word up to a space or `)`. */
function operandAt(jql: string, masked: string, from: number): string {
    const start = from + (/^\s*/.exec(masked.slice(from))?.[0].length ?? 0);
    const first = masked.charAt(start);
    if (first === '"' || first === "'") {
        const close = masked.indexOf(first, start + 1);
        return jql.slice(start, close < 0 ? jql.length : close + 1);
    }
    return /^[^\s)]+/.exec(jql.slice(start))?.[0] ?? "";
}

/** The `(...)` list that opens at `open`, quoted text included. */
function listAt(jql: string, masked: string, open: number): string {
    const close = masked.indexOf(")", open);
    return jql.slice(open, close < 0 ? jql.length : close + 1);
}

/**
 * Lines to add under a search result when the query holds a trap. `labels != x` and `labels not in (...)` also drop the
 * issues that have no labels at all, which the writer rarely means; the same goes for `component` and `fixVersion`.
 * A note and never a refusal: the query is sent as written.
 */
export function jqlNotes(jql: string): string[] {
    const masked = maskQuoted(jql);
    const notes = new Set<string>();
    for (const { name, none } of OPTIONAL_FIELDS) {
        const field = `\\b(${name.source})`;
        if (new RegExp(`${field}\\s+is\\s+(not\\s+)?(empty|null)\\b`, "i").test(masked)) continue;
        const found: Array<{ field: string; test: string }> = [];
        for (const match of masked.matchAll(new RegExp(`${field}\\s*!=`, "gi"))) {
            const written = jql.slice(match.index, match.index + (match[1]?.length ?? 0));
            const end = match.index + match[0].length;
            found.push({ field: written, test: `!= ${operandAt(jql, masked, end)}` });
        }
        for (const match of masked.matchAll(new RegExp(`${field}\\s+not\\s+in\\s*\\(`, "gi"))) {
            const written = jql.slice(match.index, match.index + (match[1]?.length ?? 0));
            const open = match.index + match[0].length - 1;
            found.push({ field: written, test: `not in ${listAt(jql, masked, open)}` });
        }
        for (const { field: written, test } of found) {
            notes.add(
                `Note: ${written} ${test} also drops the issues that have ${none}. ` +
                    `To keep them, use (${written} is EMPTY OR ${written} ${test}).`,
            );
        }
    }
    return [...notes];
}

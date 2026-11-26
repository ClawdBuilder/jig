// The module specifiers a source file imports, found by reading its text (TypeScript has no programmatic API here, and the checks that
// use this, scripts/check-runtime-deps.mjs and plugins/jig-core/test/boundaries.test.ts, only need the names).
// Groups: 1 is the word `type` of `import type` and `export type`, 2 a static import or re-export, 3 `import("...")`, 4 `require("...")`.
const IMPORT =
    /(?:^|\n)[ \t]*(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

/** What follows a dynamic import when it is written as a type: a member name, as in `import("pkg").Name`. */
const MEMBER = /^\s*\.\s*([A-Za-z_$][\w$]*)/;
/** Members a promise has: `import("pkg").then(...)` runs the import, so it is not a type. */
const PROMISE_MEMBERS = new Set(["then", "catch", "finally"]);

/**
 * Whether the dynamic import that fills `text` from `start` to `end` is a type expression and not a call: `typeof import("pkg")`
 * or `import("pkg").Name` where the name is not a promise's member. A type is erased and loads nothing. This reads only the
 * words next to the import, so it is a rule of thumb, but TypeScript allows no other shape for a type.
 */
function isTypeExpression(text, start, end) {
    if (/\btypeof\s*$/.test(text.slice(Math.max(0, start - 16), start))) return true;
    const member = MEMBER.exec(text.slice(end, end + 64));
    return member !== null && !PROMISE_MEMBERS.has(member[1] ?? "");
}

/**
 * Every specifier a text imports or re-exports, with its 1-based line: `import x from "a"`, `import "a"`, `import type { T } from "a"`,
 * `export { x } from "a"`, `export type * from "a"`, `import("a")` and `require("a")`. A statement may span lines. Only a string
 * literal counts, so a computed `import(name)` is not found.
 *
 * Each import also says whether it is `typeOnly`: written as `import type` or `export type`, or a type expression such as
 * `import("a").T`. Node removes these when it strips the types, so they load nothing at run time. `import { type X } from "a"`
 * is not type-only: Node keeps the import, and the module still loads. `import type from "a"` imports a default named `type`.
 *
 * `options.typeExpressions: false` leaves out the type expressions, `import("a").T` and `typeof import("a")`, which are not import
 * statements at all. The default keeps them, as this function always has.
 */
export function importsOf(text, options = {}) {
    const found = [];
    for (const match of text.matchAll(IMPORT)) {
        const specifier = match[2] ?? match[3] ?? match[4] ?? "";
        const start = match.index ?? 0;
        const line = text.slice(0, start + match[0].lastIndexOf(specifier)).split("\n").length;
        if (match[3] !== undefined && isTypeExpression(text, start, start + match[0].length)) {
            if (options.typeExpressions !== false) found.push({ specifier, line, typeOnly: true });
            continue;
        }
        found.push({ specifier, line, typeOnly: match[1] !== undefined });
    }
    return found;
}

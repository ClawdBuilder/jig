// The `tools` section of jig.json: its name, the tools that are never deferred, and the check of its contents. This file imports no
// Pi package, so code that runs outside Pi can read the section; `kit/tools.ts` (registering a tool with Pi) and
// `tool-exposure.ts` (the session-start step) re-export these names.
import { unknownField } from "./fields.ts";
import { isObject } from "./values.ts";

/** The `jig.json` section that holds `deferred`. jig-core checks it; a company plugin may give defaults for it. */
export const TOOLS_SECTION = "tools";

/** Pi's tool that finds and activates deferred tools (its built-in extension `builtin:tool-search`). */
export const TOOL_SEARCH = "tool_search";

/** Tools that are never deferred: Pi's own, the file tools and `bash` (which `jig-sandbox` replaces), and the finders. */
export const NOT_DEFERRABLE: ReadonlySet<string> = new Set([
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "powershell",
    "codemode",
    TOOL_SEARCH,
]);

const FIELDS = new Set(["deferred"]);
const NAME = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,63}$/;
const MAX_NAMES = 200;

/** The check of the `tools` section: `{ "deferred": ["mongo", "ops"] }`. A name that is not a Jig tool is not an error
 *  here: the tools are not all registered when the file is read, so that is said at session start. */
export function validateToolsSection(raw: unknown): string[] {
    if (!isObject(raw)) return [`${TOOLS_SECTION} must be an object such as { "deferred": ["mongo"] }`];
    const errors: string[] = [];
    for (const key of Object.keys(raw))
        if (!FIELDS.has(key)) errors.push(unknownField(TOOLS_SECTION, key, [...FIELDS]));
    const deferred = raw.deferred;
    if (deferred === undefined) return errors;
    if (!Array.isArray(deferred) || deferred.length > MAX_NAMES) {
        errors.push(`${TOOLS_SECTION}.deferred must be a list of at most ${MAX_NAMES} tool names`);
        return errors;
    }
    deferred.forEach((name, index) => {
        const at = `${TOOLS_SECTION}.deferred[${index}]`;
        if (typeof name !== "string" || !NAME.test(name)) errors.push(`${at} must be a tool name`);
        else if (NOT_DEFERRABLE.has(name)) errors.push(`${at}: ${name} is Pi's own tool and is never deferred`);
    });
    return errors;
}

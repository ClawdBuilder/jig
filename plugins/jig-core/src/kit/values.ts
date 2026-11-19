// Small stateless helpers that plugins share, so that a fix lands once and copies stop drifting. A plugin imports them
// directly (`../../jig-core/src/kit/values.ts`), as it does `client.ts`. Nothing in `kit/` holds state or talks to Pi.
import { oneLine } from "./text.ts";

/** A plain object: not null, and not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A mistake in a call's input, or in the configuration it names. jig-core takes a `TypeError` from a tool's classify or
 * preview to mean "invalid input" and blocks the call without asking, so every such finding is an InputError, which is a
 * TypeError. A TypeError from a bug in a plugin is not an InputError, and the plugin keeps it from being mistaken for one.
 */
export class InputError extends TypeError {
    constructor(message: string) {
        super(message);
        this.name = "InputError";
    }
}

/** The tool ran and refused by its own rules: the model sees the same error text, the record says blocked/refused. */
export class RefusedError extends InputError {
    constructor(message: string) {
        super(message);
        this.name = "RefusedError";
    }
}

/**
 * A section a tool needs from `jig.json` is missing or invalid, so there is no decision to take. It is an `InputError`, so
 * jig-core blocks the call without asking and the message reads as one; the class is how a test tells "the tool is not
 * configured" from "the call is wrong" without reading the text.
 */
export class NotConfiguredError extends InputError {}

/** What `notSetUpMessage` needs to name: the section (the word after `jig setup`), the plugin whose README describes it,
 *  and the section as one would write it by hand. `reader` is who the line is for: the model, which cannot run a command
 *  and so asks the person (the default), or the person, who typed a command of the plugin's own. `problem` is the first
 *  message the section's own check gave (`jig().config.problems(section)`) when the section is there but fails it. */
interface NotSetUp {
    section: string;
    plugin: string;
    needs: string;
    reader?: "model" | "person";
    problem?: string;
}

/** jig-core shows a refusal from a preview cut at this many characters, so a longer line loses its end. */
const PREVIEW_CUT = 200;

/**
 * The one line a plugin says while its section is missing or wrong. Missing: the command that sets it up first (`/jig setup`
 * in Pi, which asks every question, repairs an invalid section and writes the file), then the by-hand route. There
 * (`problem` given) but failing its check: it says so and quotes the first problem, then the same
 * command and a pointer to `/jig` for the rest; it never tells the person to add a section that is already there. The model
 * reads it and repeats it, so it is one line that names the command before the file, and at most 200 characters: the problem
 * is cut to fit, the command and the pointer never are.
 */
export function notSetUpMessage({ section, plugin, needs, reader = "model", problem }: NotSetUp): string {
    const wrong = oneLine((problem ?? "").replace(/[\u0000-\u001f\u007f]/g, " "), Number.MAX_SAFE_INTEGER);
    if (wrong !== "") {
        const fix = reader === "person" ? "fix it with" : "ask the person to fix it with";
        const head = `${section}'s settings have a problem: `;
        const tail = `; ${fix} /jig setup ${section}, or see /jig for all problems`;
        return `${head}${oneLine(wrong, Math.max(PREVIEW_CUT - head.length - tail.length, 1))}${tail}`;
    }
    const run = reader === "person" ? "run" : "ask the person to run";
    return (
        `${section} is not set up: ${run} /jig setup ${section}; ` +
        `by hand, add ${needs} to jig.json (see the ${plugin} README)`
    );
}

// Small stateless helpers that plugins share, so that a fix lands once and copies stop drifting. A plugin imports them
// directly (`../../jig-core/src/kit/values.ts`), as it does `client.ts`. Nothing in `kit/` holds state or talks to Pi.

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
 *  and so asks the person (the default), or the person, who typed a command of the plugin's own. */
export interface NotSetUp {
    section: string;
    plugin: string;
    needs: string;
    reader?: "model" | "person";
}

/**
 * The one line a plugin says while its section is missing or invalid: the command that sets it up first (`/jig setup` in Pi,
 * `jig setup` in a terminal, which asks every question, repairs an invalid section and writes the file), then the by-hand
 * route. The model reads it and repeats it, so it stays one line and names the command before the file. Keep what it says
 * short: jig-core cuts a refusal from a preview at 200 characters, so a longer line loses its end.
 */
export function notSetUpMessage({ section, plugin, needs, reader = "model" }: NotSetUp): string {
    const run = reader === "person" ? "run" : "ask the person to run";
    return (
        `${section} is not set up: ${run} /jig setup ${section} in Pi, or jig setup ${section} in a terminal; ` +
        `by hand, add ${needs} to jig.json (see the ${plugin} README)`
    );
}

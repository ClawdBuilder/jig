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

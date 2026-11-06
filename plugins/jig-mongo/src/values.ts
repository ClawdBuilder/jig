// Small helpers the modules share: the error that means "invalid input", and ways to put a value into a message.
import { oneLine, shortList, stringOf } from "../../jig-core/src/kit/text.ts";
import { InputError, isObject, RefusedError } from "../../jig-core/src/kit/values.ts";

/** Shared with the other plugins (jig-core's `kit/values.ts`). A mistake in a call's input is an InputError, a
 *  TypeError that jig-core reads as "invalid input"; tool.ts keeps a TypeError from a bug here from being mistaken for one. */
export { InputError, isObject, RefusedError };

/** Shared with the other plugins (jig-core's `kit/text.ts`), so a fix lands once. */
export { oneLine, shortList };

export type Doc = Record<string, unknown>;

/** A message from anything that was thrown. Code can throw a string or an object, not only an `Error`. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** A value as it can appear in a message: JSON on one line, cut. Control characters come out escaped. */
export function shown(value: unknown, max = 40): string {
    let text: string;
    try {
        text = JSON.stringify(value) ?? stringOf(value);
    } catch {
        text = stringOf(value);
    }
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** JSON with the keys of every object in order, so two equal values give the same text. */
export function stableJson(value: unknown): string {
    const sorted = (item: unknown): unknown => {
        if (Array.isArray(item)) return item.map(sorted);
        if (isObject(item))
            return Object.fromEntries(
                Object.keys(item)
                    .sort()
                    .map((key) => [key, sorted(item[key])]),
            );
        return item;
    };
    return JSON.stringify(sorted(value)) ?? "null";
}

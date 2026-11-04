// Putting values and names into messages without surprises. Stateless: see values.ts.

/** A name or header from another package, safe to put in a message: control characters become `?`, and it is cut at 60
 *  characters. */
export function printable(text: string): string {
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, "?");
    return clean.length > 60 ? `${clean.slice(0, 60)}...` : clean;
}

/** `String(value)`, or a stand-in for a value whose own `toString` throws (a null-prototype object, a hostile proxy). */
export function stringOf(value: unknown): string {
    try {
        return String(value);
    } catch {
        return "(cannot be shown)";
    }
}

/** The text on one line, cut after `max` characters: whitespace collapsed, and an ellipsis when it was longer. */
export function oneLine(text: string, max = 200): string {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * The items joined, cut after about `max` characters with a count of the rest. jig-core shows a blocked call's reason to
 * the model cut at 200 characters, so a message that lists choices lists only the first few.
 */
export function shortList(items: readonly string[], separator = ", ", max = 100): string {
    let text = "";
    for (const [index, item] of items.entries()) {
        const next = text === "" ? item : `${text}${separator}${item}`;
        if (text !== "" && next.length > max) return `${text} (and ${items.length - index} more)`;
        text = next;
    }
    return text;
}

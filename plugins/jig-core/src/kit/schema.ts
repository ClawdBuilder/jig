// Tool parameter schemas that read the same whichever Pi runs them. Stateless.
//
// Pi's own `StringEnum` (from `@earendil-works/pi-ai`) returns, from Pi 1.5, a schema of Pi's own schema package, which
// TypeBox's `Static` cannot read inside a `Type.Object`: a field built with it is typed `unknown`. This one is a TypeBox
// schema with the same JSON, `{ type: "string", enum: [...] }`, the form every model provider accepts (some reject
// `anyOf` with `const`).
import { Type } from "typebox";
import type { TUnsafe } from "typebox";

/** A string that is one of `values`, as TypeBox and every provider read it. */
export function stringEnum<const T extends readonly string[]>(
    values: T,
    options: { description?: string; default?: T[number] } = {},
): TUnsafe<T[number]> {
    return Type.Unsafe<T[number]>({
        type: "string",
        enum: [...values],
        ...(options.description === undefined ? {} : { description: options.description }),
        ...(options.default === undefined ? {} : { default: options.default }),
    });
}

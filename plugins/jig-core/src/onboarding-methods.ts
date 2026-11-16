// The sign-in method a section value uses: the fields a method requires, their sorted path set, and the most specific
// method whose paths the value matches. onboarding.ts checks a list; setup-plan.ts asks the questions for the method.
import type { OnboardingMethod, OnboardingMethodField } from "./contract.ts";

/** The fields every method value must have: a reference, or text that is not optional. */
export function requiredFields(method: OnboardingMethod): OnboardingMethodField[] {
    return method.fields.filter(
        (field) => field.kind === "reference" || (field.kind === "text" && field.optional !== true),
    );
}

/** The required paths of a method, sorted. Kinds and optional fields do not decide the method; the set of paths does.
 *  A subset is allowed and the most specific method wins, as long as two sets are not identical. */
export function requiredPaths(method: OnboardingMethod): string {
    return requiredFields(method)
        .map((field) => field.path)
        .sort()
        .join("|");
}

/**
 * The method a section value uses: the most specific required path set matched by the value, or undefined on a tie or
 * no match. A `*` in a method path matches one name at that level.
 */
export function inferredMethod(methods: readonly OnboardingMethod[], value: unknown): OnboardingMethod | undefined {
    const has = (current: unknown, path: string): boolean => {
        const segments = path.split(".");
        const walk = (node: unknown, index: number): boolean => {
            if (index === segments.length) return node !== undefined;
            const segment = segments[index] ?? "";
            if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
            if (segment === "*") return Object.values(node).some((child) => walk(child, index + 1));
            return Object.hasOwn(node, segment) && walk((node as Record<string, unknown>)[segment], index + 1);
        };
        return walk(current, 0);
    };
    let best: OnboardingMethod | undefined;
    let size = -1;
    let tie = false;
    for (const method of methods) {
        const required = requiredFields(method);
        if (required.length === 0 || !required.every((field) => has(value, field.path))) continue;
        const count = required.length;
        if (count > size) {
            best = method;
            size = count;
            tie = false;
        } else if (count === size) {
            tie = true;
        }
    }
    return tie ? undefined : best;
}

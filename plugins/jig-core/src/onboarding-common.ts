// The shapes and words an onboarding list shares: what a section or a path looks like, the longest a plain line may be,
// and the store names `jig.json` spells. onboarding.ts checks a list's items, onboarding-method-check.ts its methods.
import type { OnboardingStore } from "./contract-onboarding.ts";

/** The stores a list may name, in `jig.json`'s spelling. */
export const ONBOARDING_STORES: readonly OnboardingStore[] = ["pass", "env", "keychain", "op", "cmd", "file"];

export const SECTION = /^[A-Za-z][A-Za-z0-9_-]*$/;
export const PATH = /^[A-Za-z0-9_][A-Za-z0-9_-]*(\.[A-Za-z0-9_][A-Za-z0-9_-]*)*$/;
export const METHOD_ID = /^[a-z][a-z0-9-]{0,63}$/;
export const METHOD_PATH = /^(?:[A-Za-z0-9_*][A-Za-z0-9_*-]*)(?:\.[A-Za-z0-9_*][A-Za-z0-9_*-]*)*$/;
export const LABEL_MAX = 120;
export const WHY_MAX = 400;
export const DETAIL_MAX = 600;

export function oneLine(value: unknown, max: number): value is string {
    return (
        typeof value === "string" && value.trim() !== "" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
    );
}

export function optionalLine(value: unknown, at: string, max: number, errors: string[]): void {
    if (value !== undefined && !oneLine(value, max))
        errors.push(`${at}: must be one line of at most ${max} characters`);
}

/** Whether every segment of a method path is safe: not a prototype key. */
export function safeMethodPath(path: string): boolean {
    return path.split(".").every((segment) => !["__proto__", "constructor", "prototype"].includes(segment));
}

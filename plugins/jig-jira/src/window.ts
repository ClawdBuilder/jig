// Days as the person sees them. A call names whole days (`2026-10-01`), and a day is a day on the user's own clock, from
// midnight to midnight, as in jig-lens: not a UTC day and not a day in Jira's time zone. Jira's timestamps carry their own
// offset, so they are compared as instants.
import { InputError } from "./values.ts";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The first year a date may have. It keeps `new Date(year, ...)` away from the years 0 to 99, which it reads as 19xx. */
const FIRST_YEAR = 2000;

/** `YYYY-MM-DD` as its three numbers when it is a real date, else undefined. `Date` alone rolls 30 February into March. */
function partsOf(text: string): [year: number, month: number, day: number] | undefined {
    const match = DAY.exec(text);
    if (match === null) return undefined;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
    const date = new Date(Date.UTC(year, month - 1, day));
    const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
    return real && year >= FIRST_YEAR ? [year, month, day] : undefined;
}

/** A day as `YYYY-MM-DD`, or an InputError that says what a day looks like. `label` names the parameter. */
export function checkedDay(value: unknown, label: string): string {
    if (typeof value === "string" && partsOf(value.trim()) !== undefined) return value.trim();
    const shown = JSON.stringify(value)?.slice(0, 40) ?? String(value);
    throw new InputError(`jira search: ${label} must be a day such as 2026-10-01 (got ${shown})`);
}

/** The day `days` before (negative) or after `day`, by the calendar, so a clock change cannot move it. */
export function shiftDay(day: string, days: number): string {
    const [year, month, date] = partsOf(day) ?? [FIRST_YEAR, 1, 1];
    return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** A run of whole days, as instants in milliseconds since the epoch. Either end may be open. */
export interface Window {
    /** Midnight at the start of the first day, on the user's clock; the day itself is in. */
    start: number | undefined;
    /** Midnight after the last day, on the user's clock; the instant itself is out. */
    end: number | undefined;
}

/**
 * The window from the start of `from` to the end of `to`, both days included. Each end is made from the calendar date and
 * not by adding 24 hours, so the day a clock changes (23 or 25 hours long) still starts and ends at midnight.
 */
export function windowOf(from: string | undefined, to: string | undefined): Window {
    const midnight = (day: string, after: number): number => {
        const [year, month, date] = partsOf(day) ?? [FIRST_YEAR, 1, 1];
        return new Date(year, month - 1, date + after).getTime();
    };
    return {
        start: from === undefined ? undefined : midnight(from, 0),
        end: to === undefined ? undefined : midnight(to, 1),
    };
}

/** A Jira timestamp such as `2026-10-12T14:03:22.123+0000` in milliseconds since the epoch, or NaN when it is not one. */
export function stampMs(stamp: string): number {
    // The ISO form has a colon in the offset; Jira writes `+0000`.
    return Date.parse(stamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/** True when the instant is in the window. A stamp that cannot be read is in a window with no ends and out of any other. */
export function inWindow(stamp: string, window: Window): boolean {
    if (window.start === undefined && window.end === undefined) return true;
    const at = stampMs(stamp);
    if (Number.isNaN(at)) return false;
    return (window.start === undefined || at >= window.start) && (window.end === undefined || at < window.end);
}

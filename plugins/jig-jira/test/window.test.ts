// Days on the user's clock: the window a `commented` filter names, and a Jira timestamp placed in it. The time zone is set
// here, because the answer is different in every one.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { checkedDay, inWindow, shiftDay, stampMs, windowOf } from "../src/window.ts";

const HOUR = 3_600_000;
let zone: string | undefined;
before(() => {
    zone = process.env.TZ;
});
after(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

describe("windowOf", () => {
    test("a day starts at midnight on the user's clock, and both ends are in", () => {
        process.env.TZ = "Asia/Calcutta";
        const { start, end } = windowOf("2026-10-01", "2026-10-03");
        assert.equal(new Date(start ?? 0).toISOString(), "2026-09-30T18:30:00.000Z", "midnight in UTC+5:30");
        assert.equal(new Date(end ?? 0).toISOString(), "2026-10-03T18:30:00.000Z", "midnight after the 3rd");
    });

    test("the same days are other instants in another zone", () => {
        process.env.TZ = "America/Los_Angeles";
        const { start, end } = windowOf("2026-10-01", "2026-10-01");
        assert.equal(new Date(start ?? 0).toISOString(), "2026-10-01T07:00:00.000Z", "midnight in UTC-7");
        assert.equal((end ?? 0) - (start ?? 0), 24 * HOUR);
    });

    test("the day a clock changes is 25 hours or 23, and still ends at midnight", () => {
        process.env.TZ = "America/Los_Angeles";
        const autumn = windowOf("2026-11-01", "2026-11-01");
        assert.equal(((autumn.end ?? 0) - (autumn.start ?? 0)) / HOUR, 25);
        const spring = windowOf("2026-03-08", "2026-03-08");
        assert.equal(((spring.end ?? 0) - (spring.start ?? 0)) / HOUR, 23);
    });

    test("an end that is not given is open", () => {
        process.env.TZ = "UTC";
        assert.deepEqual(windowOf("2026-10-01", undefined), { start: Date.UTC(2026, 9, 1), end: undefined });
        assert.deepEqual(windowOf(undefined, "2026-10-01"), { start: undefined, end: Date.UTC(2026, 9, 2) });
        assert.deepEqual(windowOf(undefined, undefined), { start: undefined, end: undefined });
    });
});

describe("inWindow", () => {
    test("midnight is in, the instant before the start is out, and the end is out", () => {
        process.env.TZ = "Asia/Calcutta";
        const window = windowOf("2026-10-01", "2026-10-01");
        assert.equal(inWindow("2026-10-01T00:00:00.000+0530", window), true);
        assert.equal(inWindow("2026-09-30T23:59:59.999+0530", window), false);
        assert.equal(inWindow("2026-10-01T23:59:59.999+0530", window), true);
        assert.equal(inWindow("2026-10-02T00:00:00.000+0530", window), false);
    });

    test("a stamp is placed by its own offset, not by the date it is written with", () => {
        process.env.TZ = "Asia/Calcutta";
        const window = windowOf("2026-10-01", "2026-10-01");
        // Written as 30 September in UTC, but 5:30 on 1 October on the user's clock.
        assert.equal(inWindow("2026-09-30T19:00:00.000+0000", window), true);
        // Written as 1 October in UTC-7, but 2 October on the user's clock.
        assert.equal(inWindow("2026-10-01T12:00:00.000-0700", window), false);
    });

    test("with no ends every stamp is in, and an unreadable one is out of any real window", () => {
        process.env.TZ = "UTC";
        assert.equal(inWindow("not a stamp", windowOf(undefined, undefined)), true);
        assert.equal(inWindow("not a stamp", windowOf("2026-10-01", undefined)), false);
        assert.equal(inWindow("", windowOf(undefined, "2026-10-01")), false);
    });

    test("a window with one end", () => {
        process.env.TZ = "UTC";
        assert.equal(inWindow("2026-10-01T00:00:00.000+0000", windowOf("2026-10-01", undefined)), true);
        assert.equal(inWindow("2026-09-30T23:59:59.000+0000", windowOf("2026-10-01", undefined)), false);
        assert.equal(inWindow("2026-10-01T23:59:59.000+0000", windowOf(undefined, "2026-10-01")), true);
        assert.equal(inWindow("2026-10-02T00:00:00.000+0000", windowOf(undefined, "2026-10-01")), false);
    });
});

describe("stampMs", () => {
    test("reads Jira's offset with or without a colon, and Z", () => {
        const at = Date.UTC(2026, 9, 12, 14, 3, 22, 123);
        assert.equal(stampMs("2026-10-12T14:03:22.123+0000"), at);
        assert.equal(stampMs("2026-10-12T14:03:22.123+00:00"), at);
        assert.equal(stampMs("2026-10-12T14:03:22.123Z"), at);
        assert.equal(stampMs("2026-10-12T19:33:22.123+0530"), at);
        assert.equal(Number.isNaN(stampMs("yesterday")), true);
    });
});

describe("days", () => {
    test("a day is a real date from the year 2000", () => {
        assert.equal(checkedDay(" 2026-10-01 ", "from"), "2026-10-01");
        assert.equal(checkedDay("2028-02-29", "from"), "2028-02-29");
        for (const bad of ["2026-02-30", "2026-13-01", "2026-10-1", "10/01/2026", "1999-12-31", "", 20261001, null]) {
            assert.throws(
                () => checkedDay(bad, "commented.from"),
                (error: unknown) =>
                    error instanceof TypeError &&
                    error.message.startsWith("jira search: commented.from must be a day such as 2026-10-01 (got "),
                String(bad),
            );
        }
    });

    test("shifting a day goes by the calendar, across months and years", () => {
        assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
        assert.equal(shiftDay("2028-03-01", -1), "2028-02-29");
        assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
        assert.equal(shiftDay("2026-10-01", -2), "2026-09-29");
        assert.equal(shiftDay("2026-10-01", 0), "2026-10-01");
    });
});

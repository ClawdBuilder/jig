// The 500-line ratchet itself, on small lists: a new file over the limit and a grown file stop it, a shrunk one passes
// and asks for a lower baseline, and a stale entry is cleaned up. Running it against the repository is the other test.
import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-expect-error the ratchet is plain JavaScript
import { ratchet } from "../scripts/file-sizes.mjs";

const entry = (file: string, lines: number) => ({ file, lines });

test("a new file over the limit fails, and one at the limit does not", () => {
    assert.deepEqual(ratchet([entry("a.ts", 500)], {}), { failures: [], notes: [] });
    const { failures } = ratchet([entry("a.ts", 501)], {});
    assert.match(failures.join("\n"), /a\.ts has 501 lines and is not in the baseline/);
});

test("a listed file that grows fails, and one that shrinks passes and asks for a lower number", () => {
    const grown = ratchet([entry("a.ts", 520)], { "a.ts": 510 });
    assert.match(grown.failures.join("\n"), /a\.ts grew from 510 to 520 lines/);
    const shrunk = ratchet([entry("a.ts", 505)], { "a.ts": 510 });
    assert.deepEqual(shrunk.failures, []);
    assert.match(shrunk.notes.join("\n"), /a\.ts is 505 lines, down from 510: lower the baseline to 505/);
});

test("a file that comes under the limit, or goes away, is a note to remove its entry", () => {
    const smaller = ratchet([entry("a.ts", 499)], { "a.ts": 510 });
    assert.deepEqual(smaller.failures, []);
    assert.match(smaller.notes.join("\n"), /remove it from the baseline/);
    const gone = ratchet([], { "b.ts": 510 });
    assert.deepEqual(gone.failures, []);
    assert.match(gone.notes.join("\n"), /b\.ts is in the baseline but is not a source file any more/);
});

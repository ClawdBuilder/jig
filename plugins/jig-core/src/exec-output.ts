// What a program's output keeps when it passes the byte cap: the start, a ring of the end, or both ends with the middle
// left out. A cut is moved to a line boundary when one is near, never through a UTF-8 character, and the marker says how
// much was left out.
import type { OutputKeep } from "./contract.ts";

/** How far from the cut a line boundary is looked for, so a cut does not leave half a line. */
const LINE_WINDOW = 4096;

/** The bytes a UTF-8 lead byte starts, or 0 when it is not one. */
function utf8Length(byte: number): number {
    if ((byte & 0x80) === 0) return 1;
    if ((byte & 0xe0) === 0xc0) return 2;
    if ((byte & 0xf0) === 0xe0) return 3;
    if ((byte & 0xf8) === 0xf0) return 4;
    return 0;
}

/** The end of the kept bytes at `at`, moved back so no character is split (its last bytes may be dropped already). */
function utf8End(bytes: Buffer, at: number): number {
    let index = Math.min(Math.max(at, 0), bytes.length);
    while (index > 0 && ((bytes[index] ?? 0) & 0xc0) === 0x80) index -= 1;
    // The character ending at `index` starts at `lead`; keep it only when all of it is in the buffer.
    const lead = index - 1;
    const start = (() => {
        let back = lead;
        while (back > 0 && ((bytes[back] ?? 0) & 0xc0) === 0x80) back -= 1;
        return back;
    })();
    const length = utf8Length(bytes[start] ?? 0);
    if (length > 1 && start + length > index) return start;
    return index;
}

/** The start of the kept bytes at `at`, moved forward off a UTF-8 continuation byte so no character is split. */
function utf8Start(bytes: Buffer, at: number): number {
    let index = Math.min(Math.max(at, 0), bytes.length);
    while (index < bytes.length && ((bytes[index] ?? 0) & 0xc0) === 0x80) index += 1;
    return index;
}

/** The last newline in `bytes` between `from` and `to`, exclusive, or undefined. */
function lastNewline(bytes: Buffer, from: number, to: number): number | undefined {
    const found = bytes.lastIndexOf(0x0a, Math.max(from, to - 1));
    return found >= from ? found : undefined;
}

/**
 * Collects output up to a byte limit and drops the rest, so a program that prints without end cannot fill memory.
 * `keep` chooses what survives: the start (the default), a ring of the end, or both ends with the middle left out. The
 * cut is moved to a line boundary when one is near and never through a UTF-8 character, and the marker says how much
 * was left out.
 */
export function collector(limit: number, keep: OutputKeep = "head"): { add(chunk: Buffer): void; text(): string } {
    const head: Buffer[] = [];
    let headKept = 0;
    const tail: Buffer[] = [];
    let tailKept = 0;
    let total = 0;
    const keepHead = keep !== "tail";
    const keepTail = keep !== "head";
    return {
        add(chunk) {
            total += chunk.length;
            if (keepHead) {
                const room = limit - headKept;
                if (room > 0) {
                    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
                    head.push(piece);
                    headKept += piece.length;
                }
            }
            if (keepTail) {
                tail.push(chunk);
                tailKept += chunk.length;
                // Keep a little more than the limit so a line boundary near the cut can be found.
                while (tailKept - (tail[0]?.length ?? 0) >= limit + LINE_WINDOW) tailKept -= tail.shift()?.length ?? 0;
            }
        },
        // The marker tells the caller the output is incomplete, which a plain cut would hide.
        text() {
            // Nothing was cut: the whole stream comes back untouched, with no trim and no marker, for every keep.
            if (total <= limit) {
                return Buffer.concat(keepHead ? head : tail)
                    .subarray(0, total)
                    .toString("utf8");
            }
            const parts: Buffer[] = [];
            let shown = 0;
            if (keepHead && headKept > 0) {
                const bytes = Buffer.concat(head);
                let end = utf8End(bytes, limit);
                const newline = lastNewline(bytes, Math.max(0, end - LINE_WINDOW), end);
                if (newline !== undefined) end = newline + 1;
                parts.push(bytes.subarray(0, end));
                shown += end;
            }
            if (keepTail && tailKept > 0) {
                const bytes = Buffer.concat(tail);
                // The ring's first byte sits at this offset in the stream; the tail may not begin before the head ended,
                // or a short stream (or one under twice the limit) prints the same bytes twice.
                const ringStart = total - tailKept;
                let start = utf8Start(bytes, Math.max(0, bytes.length - limit));
                const newline = bytes.indexOf(0x0a, start);
                if (newline !== -1 && newline < start + LINE_WINDOW) start = newline + 1;
                start = Math.max(start, shown - ringStart);
                if (start < bytes.length) {
                    parts.push(bytes.subarray(start));
                    shown += bytes.length - start;
                }
            }
            const leftOut = total - shown;
            if (leftOut <= 0) return Buffer.concat(parts).toString("utf8");
            const marker =
                keep === "head"
                    ? `[output cut at ${limit} bytes]`
                    : keep === "tail"
                      ? `[output cut: the first ${leftOut} bytes were left out]`
                      : `[output cut: ${leftOut} bytes were left out in the middle]`;
            return `${Buffer.concat(parts).toString("utf8")}\n${marker}\n`;
        },
    };
}

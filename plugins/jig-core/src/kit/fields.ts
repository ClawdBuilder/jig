// One error for a field a section does not have: the closest valid name when one is within two edits, and the valid
// names at that level. The same wording for jig-core's sections and every plugin's.
function editDistance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0] as number;
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j] as number;
            row[j] = Math.min(
                (row[j] as number) + 1,
                (row[j - 1] as number) + 1,
                previous + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            previous = current;
        }
    }
    return row[b.length] as number;
}

/** The closest valid name within two edits, for "did you mean". */
export function closestField(key: string, valid: readonly string[]): string | undefined {
    let best: string | undefined;
    let bestDistance = 3;
    for (const name of valid) {
        const distance = editDistance(key.toLowerCase(), name.toLowerCase());
        if (distance < bestDistance) {
            best = name;
            bestDistance = distance;
        }
    }
    return best;
}

/** `<path>.<key>: unknown field … Valid keys: …`, or the closest spelling when one is within two edits. */
export function unknownField(path: string, key: string, valid: readonly string[]): string {
    const near = closestField(key, valid);
    const hint = near === undefined ? "" : ` Did you mean "${near}"?`;
    const at = path === "" ? key : `${path}.${key}`;
    return `${at}: unknown field.${hint} Valid keys: ${valid.join(", ")}`;
}

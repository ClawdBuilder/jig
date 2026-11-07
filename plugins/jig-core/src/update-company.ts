// The company packages that cap which Jig release an update may install. A package opts in with
// `"jig": { "range": ">=0.4.1 <0.5.0" }` in its own package.json; no field means no cap.
import type { ListedPackage } from "./cli/packages.ts";
import type { CompanyRange } from "./update-versions.ts";
import { manifestOf } from "./cli/packages.ts";

/** Every installed company package's range, by package name. Jig itself is not a cap. */
export function companyRanges(listed: readonly ListedPackage[], jigName: string): CompanyRange[] {
    const ranges: CompanyRange[] = [];
    const seen = new Set<string>();
    for (const entry of listed) {
        const manifest = entry.folder === undefined ? undefined : manifestOf(entry.folder);
        const range = manifest?.jig?.range;
        const name = manifest?.name;
        if (range === undefined || name === undefined || name === jigName || seen.has(name)) continue;
        seen.add(name);
        ranges.push({ package: name, range });
    }
    return ranges;
}

// The changelog's fragments: one file per user-visible change in `changelog.d/`, folded by `scripts/release.mjs` into the
// next release's section. A fragment is a `### Added`, `### Changed`, `### Fixed` or `### Removed` heading and the list
// line(s) under it. `scripts/check-changelog-fragments.mjs` reports a fragment a release could not fold.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** The headings a fragment may use, in the order a release writes them. */
export const HEADINGS = ["Added", "Changed", "Fixed", "Removed"];

/** The problems a release would have with one fragment's text; each names no file. */
export function fragmentProblems(text) {
    const lines = text.split("\n");
    const first = lines.find((line) => line.trim() !== "");
    if (first === undefined) return ["is empty: it needs a `### Added` heading and a `- ` line"];
    const heading = /^### (.+)$/.exec(first);
    if (heading === null) return ["the first line must be a heading such as `### Added`"];
    const name = (heading[1] ?? "").trim();
    const problems = [];
    if (!HEADINGS.includes(name)) problems.push(`"${name}" is not a heading; use ${HEADINGS.join(", ")}`);
    if (lines.filter((line) => /^### /.test(line)).length > 1) {
        problems.push("holds more than one heading; one file is one change");
    }
    if (!lines.some((line) => line.startsWith("- "))) problems.push("has no `- ` line under its heading");
    return problems;
}

/**
 * Every `.md` file directly in the folder, in name order, with the problems that keep a release from folding it. A file
 * that is not `.md` is ignored, so the folder can hold its own `.gitkeep`. `checked` counts every `.md` file read, valid or
 * not; `label` names the folder in a problem.
 */
export function readFragments(folder, label = "changelog.d") {
    let entries;
    try {
        entries = readdirSync(folder, { withFileTypes: true });
    } catch {
        return { files: [], problems: [`${label}/ is missing`], checked: 0 };
    }
    const files = [];
    const problems = [];
    const names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort();
    for (const name of names) {
        let text;
        try {
            text = readFileSync(path.join(folder, name), "utf8");
        } catch {
            problems.push(`${label}/${name}: cannot be read`);
            continue;
        }
        const found = fragmentProblems(text);
        if (found.length === 0) files.push({ name, text });
        else problems.push(...found.map((problem) => `${label}/${name}: ${problem}`));
    }
    return { files, problems, checked: names.length };
}

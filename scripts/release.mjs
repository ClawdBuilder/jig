// `node scripts/release.mjs <version>`: what cutting a release changes. It folds every fragment in `changelog.d/` into a dated
// `## [<version>]` section, with the entries of repeated `### Added`, `### Changed`, `### Fixed` and `### Removed` headings
// gathered under one of each, deletes the fragments, leaves the sentence under `## [Unreleased]` that points at the folder,
// and raises `version` in package.json. It commits nothing and tags nothing: docs/releases.md says what comes next.
//   node scripts/release.mjs 0.3.0 [--date 2026-11-04] [--root <folder>] [--dry-run]
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HEADINGS, readFragments } from "./changelog-fragments.mjs";

/** A version this repository releases: three numbers, as package.json holds it. */
const EXACT = /^\d+\.\d+\.\d+$/;

/** The date in a changelog heading. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The order the changelog writes its headings in. */
const ORDER = HEADINGS;

/** The `version` of a package.json's text. */
export function versionOf(manifest) {
    return JSON.parse(manifest).version;
}

/** Compares two `x.y.z` versions: negative when `a` is older than `b`, zero when they are the same. */
export function compare(a, b) {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let index = 0; index < 3; index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

/** The lines under `## [Unreleased]`, up to the next `## ` heading. */
export function unreleased(changelog) {
    const lines = changelog.split("\n");
    const start = lines.findIndex((line) => line.trim() === "## [Unreleased]");
    if (start === -1) return undefined;
    const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
    return lines.slice(start + 1, end === -1 ? lines.length : end).join("\n");
}

/** The body's `### ` sections, gathered into one of each: Added, Changed, Fixed and Removed first, then any other in its own
 *  place. A heading that appears twice keeps its entries in the order they were written, and the bullets of every fragment
 *  under a heading are one tight list, as the earlier sections are: no blank line between two `- ` lines. */
export function gather(body) {
    const sections = new Map();
    let current;
    for (const line of body.split("\n")) {
        const heading = /^### (.+)$/.exec(line);
        if (heading) {
            current = (heading[1] ?? "").trim();
            if (!sections.has(current)) sections.set(current, []);
            sections.get(current).push([]);
            continue;
        }
        if (current !== undefined) sections.get(current).at(-1).push(line);
    }
    return [...sections.keys()]
        .sort((a, b) => rank(a) - rank(b))
        .map((name) => ({
            name,
            lines: sections
                .get(name)
                .map(tidy)
                .filter((block) => block.length > 0)
                .flatMap((block, index) => (index === 0 || (block[0] ?? "").startsWith("- ") ? block : ["", ...block])),
        }))
        .filter((section) => section.lines.length > 0);
}

function rank(name) {
    const index = ORDER.indexOf(name);
    return index === -1 ? ORDER.length : index;
}

/** The lines without the blank ones at either end, and with no two blank lines in a row: a changelog has one blank line
 *  between paragraphs, and a blank line inside a fenced block is kept. A blank line before a `- ` line is dropped, so the
 *  bullets of a fragment are a tight list; one before an indented line, a paragraph or a fence stays, so a bullet's own
 *  paragraphs and blocks keep their separation. */
function tidy(lines) {
    const kept = [];
    let fence;
    let blank = false;
    for (const line of lines) {
        const mark = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (fence === undefined) {
            if (line.trim() === "") {
                blank = kept.length > 0;
                continue;
            }
            if (blank && !line.startsWith("- ")) kept.push("");
            blank = false;
            if (mark !== undefined) fence = mark;
        } else if (mark !== undefined && mark[0] === fence[0] && mark.length >= fence.length) {
            fence = undefined;
        }
        kept.push(line);
    }
    while (kept.length > 0 && (kept.at(-1) ?? "").trim() === "") kept.pop();
    return kept;
}

/** The lines before the first heading or list line of the Unreleased body: the sentence that points at changelog.d/. */
function introOf(body) {
    const kept = [];
    for (const line of body.split("\n")) {
        if (/^### /.test(line) || line.startsWith("- ")) break;
        kept.push(line);
    }
    return tidy(kept);
}

/** The changelog with `body` (the fragments) under `## [<version>] - <date>`, or the problem that stops it. */
export function cut(changelog, version, date, body) {
    const sections = gather(body);
    if (sections.length === 0) return { problem: "changelog.d/ has no fragments: nothing to release" };
    const released = sections.map((section) => `### ${section.name}\n\n${section.lines.join("\n")}`).join("\n\n");
    const lines = changelog.split("\n");
    const start = lines.findIndex((line) => line.trim() === "## [Unreleased]");
    if (start === -1) return { problem: "CHANGELOG.md has no `## [Unreleased]` heading" };
    const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
    const intro = introOf(lines.slice(start + 1, end === -1 ? lines.length : end).join("\n"));
    const head = lines.slice(0, start + 1);
    const tail = lines.slice(end === -1 ? lines.length : end);
    return {
        text: [
            ...head,
            "",
            ...(intro.length === 0 ? [] : [...intro, ""]),
            `## [${version}] - ${date}`,
            "",
            released,
            "",
            ...tail,
        ].join("\n"),
    };
}

/** Both files after a release, or the problems that stop it. Nothing is written by this function. */
export function release({ changelog, manifest, version, date, fragments = [], problems: fragmentProblems = [] }) {
    const problems = [...fragmentProblems];
    if (!EXACT.test(version)) problems.push(`"${version}" is not a version of the form 1.2.3`);
    if (!DATE.test(date)) problems.push(`"${date}" is not a date of the form 2026-11-04`);
    const current = versionOf(manifest);
    if (EXACT.test(version) && compare(version, current) <= 0) {
        problems.push(`${version} is not newer than package.json's ${current}`);
    }
    const previous = unreleased(changelog);
    if (previous?.split("\n").some((line) => /^### /.test(line) || line.startsWith("- "))) {
        problems.push("`## [Unreleased]` has entries: put each change in changelog.d/");
    }
    const body = fragments.map((fragment) => fragment.text.trimEnd()).join("\n\n");
    let text;
    if (fragmentProblems.length === 0) {
        const cutResult = cut(changelog, version, date, body);
        if (cutResult.problem !== undefined) problems.push(cutResult.problem);
        else text = cutResult.text;
    }
    if (problems.length > 0) return { problems };
    return {
        problems: [],
        changelog: text,
        manifest: manifest.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`),
    };
}

/** Today where this runs, as the changelog writes it. Local, so a release cut in the morning keeps its own date. */
export function today(now = new Date()) {
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const version = args[0];
    if (version === undefined || version.startsWith("--")) {
        console.error("usage: node scripts/release.mjs <version> [--date YYYY-MM-DD] [--root <folder>] [--dry-run]");
        process.exit(2);
    }
    const flag = (name) => {
        const index = args.indexOf(name);
        return index === -1 ? undefined : args[index + 1];
    };
    const dryRun = args.includes("--dry-run");
    const date = flag("--date") ?? today();
    const root = path.resolve(flag("--root") ?? path.join(path.dirname(process.argv[1]), ".."));
    const files = {
        manifest: path.join(root, "package.json"),
        changelog: path.join(root, "CHANGELOG.md"),
    };
    const changelog = readFileSync(files.changelog, "utf8");
    const fragments = readFragments(path.join(root, "changelog.d"));
    const result = release({
        changelog,
        manifest: readFileSync(files.manifest, "utf8"),
        version,
        date,
        fragments: fragments.files,
        problems: fragments.problems,
    });
    if (result.problems.length > 0) {
        console.error(`Nothing was written; a release needs:\n  ${result.problems.join("\n  ")}`);
        process.exit(1);
    }
    if (!dryRun) {
        writeFileSync(files.changelog, result.changelog);
        writeFileSync(files.manifest, result.manifest);
        for (const fragment of fragments.files) rmSync(path.join(root, "changelog.d", fragment.name));
    }
    const entries = gather(fragments.files.map((fragment) => fragment.text).join("\n\n")).reduce(
        (count, section) => count + section.lines.filter((line) => line.startsWith("- ")).length,
        0,
    );
    console.log(
        [
            `${version}: ${dryRun ? "would change" : "changed"} CHANGELOG.md and package.json`,
            `  CHANGELOG.md: ## [Unreleased] keeps its sentence, and ## [${version}] - ${date} holds ${entries} entries`,
            `  changelog.d: ${dryRun ? "would fold and delete" : "folded and deleted"} ${fragments.files.length} fragment${
                fragments.files.length === 1 ? "" : "s"
            }`,
            `  package.json: version is ${version}`,
            `Next: review the diff, commit "Release ${version}", tag v${version}, and push the branch and the tag.`,
            "docs/releases.md has the whole process.",
        ].join("\n"),
    );
}

// When the Pi canary fails, say so where a person will see it: one open issue, or a comment on the open one. The issue
// names the Pi version that was tried and links the run. It goes through `gh` with the workflow's token, so nothing here
// writes to GitHub itself. DRY_RUN=1 prints what it would do and calls nothing.
import { spawnSync } from "node:child_process";

const TITLE = "Pi canary red";
const repo = process.env.GITHUB_REPOSITORY ?? "";
const server = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const runUrl = `${server}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;
const version = process.env.PI_VERSION?.trim() || "the newest on npm";
const dry = process.env.DRY_RUN === "1";

function gh(args) {
    if (dry) {
        console.log(`dry run: gh ${args.join(" ")}`);
        return "";
    }
    const result = spawnSync("gh", args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
    return result.stdout;
}

const detail = `- Pi: ${version}
- Run: ${runUrl}`;

const listed = dry ? [] : JSON.parse(gh(["api", `repos/${repo}/issues?state=open&per_page=100`]) || "[]");
const existing = listed.find(
    (issue) => issue.pull_request === undefined && String(issue.title ?? "").startsWith(TITLE),
);

if (existing !== undefined) {
    const body = `The canary failed again.

${detail}

A red run means "look at the new Pi", not that a change is bad (docs/compatibility.md).`;
    gh(["api", `repos/${repo}/issues/${existing.number}/comments`, "--method", "POST", "-f", `body=${body}`]);
    console.log(`commented on #${existing.number}`);
} else {
    const body = `The scheduled Pi canary failed: the newest Pi on npm does not pass Jig's checks.

${detail}

A red run means "look at the new Pi", not that a change is bad (docs/compatibility.md). CI stays pinned to the tested
version until this is understood.`;
    gh([
        "api",
        `repos/${repo}/issues`,
        "--method",
        "POST",
        "-f",
        `title=${TITLE}`,
        "-f",
        "labels[]=bug",
        "-f",
        `body=${body}`,
    ]);
    console.log(`opened "${TITLE}"`);
}

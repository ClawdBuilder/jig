// The workflow files and the "Tested with" tables, held together. These are the things nobody sees break: a new job that the required check
// does not wait for, an action that is a moving tag, a Pi version that is moved in one place and not in the others.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { parse } from "yaml";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

interface Job {
    name?: string;
    if?: string;
    needs?: string | string[];
    uses?: string;
    strategy?: { matrix?: { node?: number[] } };
    steps?: Array<{ uses?: string }>;
}
interface Workflow {
    on: Record<string, unknown>;
    permissions?: unknown;
    jobs: Record<string, Job>;
}
const workflow = (file: string): Workflow => parse(read(`.github/workflows/${file}`)) as Workflow;
const workflows = readdirSync(path.join(ROOT, ".github/workflows")).filter((name) => /\.ya?ml$/.test(name));

describe("ci.yml", () => {
    const ci = workflow("ci.yml");

    test("ci-ok is the one check to require: it needs every other job, runs even when one failed, and has a fixed name", () => {
        const job = ci.jobs["ci-ok"];
        assert.ok(job, "ci.yml has no ci-ok job");
        assert.equal(job.name, "ci-ok", "branch protection requires the job by this name");
        assert.match(String(job.if), /always\(\)/);
        assert.deepEqual(
            [job.needs].flat().sort(),
            Object.keys(ci.jobs)
                .filter((name) => name !== "ci-ok")
                .sort(),
        );
    });

    test("the checks job ends by asking that the working tree is clean", () => {
        const text = read(".github/workflows/ci.yml");
        const checks = text.slice(text.indexOf("\n  checks:"), text.indexOf("\n  workflows:"));
        const last = checks.lastIndexOf("      - name:");
        assert.match(checks.slice(last), /name: The working tree is clean[\s\S]*git status --porcelain/);
    });

    test("the workflow files are linted with a pinned actionlint, built through the checksummed Go module proxy", () => {
        const text = read(".github/workflows/ci.yml");
        assert.match(text, /ACTIONLINT_VERSION: \d+\.\d+\.\d+/);
        assert.match(text, /go install "github\.com\/rhysd\/actionlint\/cmd\/actionlint@v\$\{ACTIONLINT_VERSION\}"/);
        assert.doesNotMatch(
            text,
            /GOFLAGS=.*-insecure|GONOSUMDB|GONOSUMCHECK|GOSUMDB=off/,
            "the Go checksum database stays on",
        );
        assert.doesNotMatch(text, /github\.com\/[^\s"]+\/releases\/download/, "no GitHub release downloads");
    });

    test("every apt-get has a timeout and retries, and update is retried", () => {
        for (const file of workflows) {
            const text = read(`.github/workflows/${file}`);
            const apt = text.split("\n").filter((line) => /^\s*sudo apt-get\b/.test(line));
            if (apt.length === 0) continue;
            for (const line of apt) {
                assert.match(line, /-o Acquire::http::Timeout=30/, `${file}: ${line}`);
                assert.match(line, /-o Acquire::Retries=3/, `${file}: ${line}`);
            }
            assert.match(
                text,
                /for attempt in 1 2 3; do[\s\S]*?apt-get[\s\S]*?update && break[\s\S]*?done/,
                `${file}: apt-get update is not retried`,
            );
        }
    });


    test("npm ci never runs a dependency's install script", () => {
        for (const file of workflows) {
            for (const match of read(`.github/workflows/${file}`).matchAll(/run: (npm ci.*)$/gm)) {
                assert.match(match[1] ?? "", /--ignore-scripts/, `${file}: ${match[1]}`);
            }
        }
    });
});

describe("every workflow", () => {
    for (const file of workflows) {
        test(`${file}: sets its permissions, and pins every action to a full commit SHA`, () => {
            const flow = workflow(file);
            assert.ok(flow.permissions !== undefined, "no top-level permissions");
            const uses = Object.values(flow.jobs).flatMap((job) => [
                job.uses,
                ...(job.steps ?? []).map((step) => step.uses),
            ]);
            for (const reference of uses.filter((value): value is string => value !== undefined)) {
                if (reference.startsWith("./")) continue;
                assert.match(
                    reference,
                    /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/,
                    `${file}: ${reference} is not pinned to a commit`,
                );
            }
        });
    }
});

describe("the Pi canary", () => {
    const canary = workflow("pi-canary.yml");

    test("runs weekly and by hand, and never on a push or a pull request", () => {
        assert.deepEqual(Object.keys(canary.on).sort(), ["schedule", "workflow_dispatch"]);
        const schedule = canary.on.schedule as Array<{ cron: string }>;
        assert.equal(schedule.length, 1);
        assert.match(schedule[0]?.cron ?? "", /^\d+ \d+ \* \* [0-6]$/, "once a week");
    });

    test("installs the newest Pi, and runs the checks, the tests and the install check", () => {
        const text = read(".github/workflows/pi-canary.yml");
        assert.match(text, /npm install -g @earendil-works\/pi-coding-agent@latest/);
        for (const command of ["npm run check", "npm test", "npm run check:install"]) {
            assert.ok(new RegExp(`run: ${command}$`, "m").test(text), `the canary does not run ${command}`);
        }
        assert.doesNotMatch(text, /pi-coding-agent@\d/, "the canary must not pin a version");
    });
});

describe("the Pi version Jig is tested with", () => {
    const ci = read(".github/workflows/ci.yml");
    const pins = [...ci.matchAll(/pi-coding-agent@(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
    const pinned = pins[0] ?? "";
    const nodes = (workflow("ci.yml").jobs.checks?.strategy?.matrix?.node ?? []).map(String).sort();

    test("both CI jobs install the same exact Pi", () => {
        assert.equal(pins.length, 2, "ci.yml installs Pi in the checks job and in the integration job");
        assert.equal(new Set(pins).size, 1, `ci.yml pins ${pins.join(" and ")}`);
        assert.match(pinned, /^\d+\.\d+\.\d+$/);
    });

    test(`docs/compatibility.md: the "Tested with" row is that Pi, the Node lines of the checks job, and a date`, () => {
        const row = /^\| (\d+\.\d+\.\d+) \| ([\d., ]+) \| (\d{4}-\d{2}-\d{2}) \|$/m.exec(read("docs/compatibility.md"));
        assert.ok(row, 'docs/compatibility.md has no "Tested with" row');
        assert.equal(row[1], pinned);
        assert.deepEqual(
            (row[2] ?? "")
                .split(",")
                .map((node) => node.trim())
                .sort(),
            nodes,
        );
    });

    test("the README states the same tested Pi in its one sentence", () => {
        const readme = read("README.md");
        const stated = /tested with (\d+\.\d+\.\d+)/i.exec(readme);
        assert.ok(stated, "the README has no tested-version sentence");
        assert.equal(stated[1], pinned);
    });

    test("package.json's exact Pi devDependencies move with the pinned Pi", () => {
        const manifest = JSON.parse(read("package.json")) as { devDependencies?: Record<string, string> };
        const development = manifest.devDependencies ?? {};
        assert.equal(development["@earendil-works/pi-coding-agent"], pinned);
        for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox"]) {
            assert.match(development[name] ?? "", /^\d+\.\d+\.\d+$/, `${name} is not exact`);
        }
    });

    test("AGENTS.md and the integration test page name the same Pi", () => {
        assert.ok(read("AGENTS.md").includes(`pi-coding-agent@${pinned}`), "AGENTS.md installs another Pi");
        assert.ok(
            read("docs/integration-tests.md").includes(`Pi ${pinned}`),
            "docs/integration-tests.md names another Pi",
        );
    });
});

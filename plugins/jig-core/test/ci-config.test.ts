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
    "runs-on"?: string;
    "timeout-minutes"?: number;
    needs?: string | string[];
    uses?: string;
    permissions?: unknown;
    strategy?: { matrix?: { node?: Array<number | string>; os?: string[] } };
    steps?: Array<{ uses?: string; name?: string; run?: string; shell?: string }>;
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
                .filter((name) => name !== "ci-ok" && !name.endsWith("-advisory"))
                .sort(),
        );
    });

    test("the advisory macOS job runs the checks and the suite, outside ci-ok", () => {
        const job = ci.jobs["macos-advisory"];
        assert.ok(job, "ci.yml has no macos-advisory job");
        assert.equal(job.name, "macOS (advisory)", "the name says advisory");
        assert.equal(job["runs-on"], "macos-latest");
        assert.equal(job["timeout-minutes"], 30);
        assert.equal([ci.jobs["ci-ok"]?.needs].flat().includes("macos-advisory"), false, "it does not gate ci-ok");
        const text = read(".github/workflows/ci.yml");
        const block = text.slice(text.indexOf("\n  macos-advisory:"), text.indexOf("\n  ci-ok:"));
        for (const step of ["npm ci --ignore-scripts", "npm run check", "npm test"])
            assert.ok(block.includes(step), `the advisory job runs ${step}`);
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

    test("npm test and test:it give every test a timeout", () => {
        const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
        for (const name of ["test", "test:it"]) {
            assert.match(scripts[name] ?? "", /--test-timeout=600000/, name);
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

    test("a red run opens one issue, or comments on the open one, with the version and the run", () => {
        const report = canary.jobs.report;
        assert.ok(report, "the canary has no report job");
        assert.deepEqual(report.needs, "canary");
        assert.match(String(report.if), /failure\(\)/);
        assert.deepEqual((report as { permissions?: unknown }).permissions, { contents: "read", issues: "write" });
        const text = read(".github/workflows/pi-canary.yml");
        assert.match(text, /PI_VERSION: \$\{\{ needs\.canary\.outputs\.pi \}\}/);
        assert.match(text, /run: node scripts\/canary-issue\.mjs/);
        // The workflow's own token keeps read-only contents; only the report job may write issues.
        assert.deepEqual(canary.permissions, { contents: "read" });
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

describe("the gateway and Claude Code jobs of ci.yml", () => {
    const ci = workflow("ci.yml");
    const manifest = JSON.parse(read("package.json")) as {
        engines: { node: string };
        jig: { agents: Record<string, { minimum: string; tested: string }> };
    };
    const tested = manifest.jig.agents["claude-code"]?.tested ?? "";
    const runs = (job: Job | undefined): string[] => (job?.steps ?? []).map((step) => step.run ?? "");
    /** GitHub's expression syntax, written from parts so that no string here looks like a template that lost its backticks. */
    const expression = (inner: string): string => ["$", "{{ ", inner, " }}"].join("");

    test("the claude-code job installs exactly the Claude Code that package.json says is tested, and runs the plugin check", () => {
        const job = ci.jobs["claude-code"];
        assert.ok(job, "ci.yml has no claude-code job");
        assert.equal(job.name, "Claude Code plugin");
        assert.match(tested, /^\d+\.\d+\.\d+$/);
        const installs = [...read(".github/workflows/ci.yml").matchAll(/@anthropic-ai\/claude-code@(\S+)/g)].map(
            (match) => match[1],
        );
        assert.deepEqual(installs, [tested], "one install of Claude Code in ci.yml, at jig.agents.claude-code.tested");
        // npm 12 runs a package's install script only when --allow-scripts names it, and Claude Code's program is put in place by one.
        assert.ok(
            runs(job).some((run) =>
                run.includes(
                    `npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code@${tested}`,
                ),
            ),
            "the install names the version and lets the package's install script run",
        );
        assert.ok(runs(job).includes("npm run check:claude"));
        assert.equal(
            runs(job).some((run) => /\bnpm ci\b/.test(run)),
            false,
            "the plugin check needs no npm ci",
        );
    });

    test("the gateway job runs on Linux on the oldest Node that package.json allows and on 26, and gates ci-ok", () => {
        const job = ci.jobs.gateway;
        assert.ok(job, "ci.yml has no gateway job");
        assert.equal(job.name, `Gateway, no Pi (Node ${expression("matrix.node")})`);
        assert.equal(job["runs-on"], "ubuntu-24.04");
        assert.equal(job["timeout-minutes"], 15);
        assert.deepEqual(job.strategy?.matrix?.node?.map(String), [manifest.engines.node.replace(/^>=/, ""), "26"]);
        const needs = [ci.jobs["ci-ok"]?.needs].flat();
        assert.ok(needs.includes("gateway") && needs.includes("claude-code"), "ci-ok waits for both");
    });

    test("the advisory gateway job runs on macOS and Windows, with the same steps in bash, outside ci-ok", () => {
        const job = ci.jobs["gateway-advisory"];
        assert.ok(job, "ci.yml has no gateway-advisory job");
        assert.equal(job.name, `Gateway, no Pi (${expression("matrix.os")}, advisory)`);
        assert.deepEqual(job.strategy?.matrix?.os, ["macos-latest", "windows-latest"]);
        assert.equal(job["timeout-minutes"], 20);
        assert.equal([ci.jobs["ci-ok"]?.needs].flat().includes("gateway-advisory"), false, "it does not gate ci-ok");
        const shells = (job.steps ?? []).filter((step) => step.run !== undefined).map((step) => step.shell);
        assert.deepEqual([...new Set(shells)], ["bash"], "one shell on both systems");
    });

    for (const id of ["gateway", "gateway-advisory"]) {
        test(`${id} never installs Pi and never runs npm ci: its point is a machine with no Pi`, () => {
            const job = ci.jobs[id];
            assert.ok(job, `ci.yml has no ${id} job`);
            const all = runs(job).join("\n");
            assert.doesNotMatch(all, /\bnpm (ci|install|i|add)\b/, "nothing is installed");
            assert.doesNotMatch(
                all,
                /pi-coding-agent@|\bpi install\b|@earendil-works\/\S+@/,
                "no Pi version is installed",
            );
            assert.ok(
                (job.steps ?? []).some(
                    (step) =>
                        step.name === "No Pi on this machine" &&
                        /npm ls -g[^\n]*@earendil-works\/pi-coding-agent/.test(step.run ?? "") &&
                        /exit 1/.test(step.run ?? ""),
                ),
                "a step fails the job when a global Pi is found",
            );
            assert.ok(runs(job).includes("npm run check:gateway"));
        });
    }
});

describe("every canary", () => {
    for (const file of ["pi-canary.yml", "claude-code-canary.yml"]) {
        test(`${file}: only the report job may write issues, and it runs the shared issue script`, () => {
            const canary = workflow(file);
            assert.deepEqual(canary.permissions, { contents: "read" });
            for (const [name, job] of Object.entries(canary.jobs)) {
                if (name === "report") continue;
                assert.doesNotMatch(
                    JSON.stringify(job.permissions ?? {}),
                    /issues/,
                    `${file}: ${name} may write issues`,
                );
            }
            assert.deepEqual(canary.jobs.report?.permissions, { contents: "read", issues: "write" });
            assert.match(read(`.github/workflows/${file}`), /run: node scripts\/canary-issue\.mjs$/m);
        });
    }
});

describe("the Claude Code canary", () => {
    const canary = workflow("claude-code-canary.yml");
    const text = read(".github/workflows/claude-code-canary.yml");

    test("runs weekly and by hand, and never on a push or a pull request", () => {
        assert.deepEqual(Object.keys(canary.on).sort(), ["schedule", "workflow_dispatch"]);
        const schedule = canary.on.schedule as Array<{ cron: string }>;
        assert.equal(schedule.length, 1);
        assert.match(schedule[0]?.cron ?? "", /^\d+ \d+ \* \* [0-6]$/, "once a week");
    });

    test("installs the newest Claude Code, never a pinned one, and runs the plugin check", () => {
        assert.match(
            text,
            /npm install -g --allow-scripts=@anthropic-ai\/claude-code @anthropic-ai\/claude-code@latest/,
            "the newest release, with its install script allowed",
        );
        assert.doesNotMatch(text, /claude-code@\d/, "the canary must not pin a version");
        assert.match(text, /^\s+run: npm run check:claude$/m);
    });

    test("a red run opens one issue, or comments on the open one, naming Claude Code, its version and the run", () => {
        const report = canary.jobs.report;
        assert.ok(report, "the canary has no report job");
        assert.equal(report.needs, "canary");
        assert.match(String(report.if), /failure\(\)/);
        assert.match(text, /CANARY_AGENT: Claude Code/);
        assert.match(text, /CANARY_VERSION: \$\{\{ needs\.canary\.outputs\.claude \}\}/);
        assert.match(
            text,
            /^\s+claude: \$\{\{ steps\.claude\.outputs\.version \}\}$/m,
            "the canary job hands on the version",
        );
    });
});

describe("the Pi version Jig is tested with", () => {
    const ci = read(".github/workflows/ci.yml");
    const pins = [...ci.matchAll(/pi-coding-agent@(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
    const pinned = pins[0] ?? "";
    const nodes = (workflow("ci.yml").jobs.checks?.strategy?.matrix?.node ?? []).map(String).sort();

    test("every CI job that installs Pi installs the same exact version", () => {
        assert.equal(pins.length, 3, "checks, integration and the advisory macOS job");
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

describe("the Claude Code version Jig is tested with", () => {
    const manifest = JSON.parse(read("package.json")) as { jig: { agents: Record<string, { tested: string }> } };
    const tested = manifest.jig.agents["claude-code"]?.tested ?? "";

    test(`docs/compatibility.md: the Claude Code "Tested with" row is that version, and a date`, () => {
        const row = /^\| (\d+\.\d+\.\d+) \| (\d{4}-\d{2}-\d{2}) \|$/m.exec(read("docs/compatibility.md"));
        assert.ok(row, 'docs/compatibility.md has no Claude Code "Tested with" row');
        assert.equal(row[1], tested);
    });
});

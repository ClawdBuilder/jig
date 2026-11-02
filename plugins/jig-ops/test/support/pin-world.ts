// A control repository for the pin tests: the catalog of a service whose staging is pinned by a pull request and whose
// production is only read, and the answers a fake `gh` gives for the GitHub API calls the pin reads make (contents, commits,
// refs and pull requests). Nothing here reaches GitHub.
//
//   checkout  staging     `pin` deploy: acme/deploy-control, main, one file, the Concourse job checkout-staging
//             qa          `pin` deploy with two files and a kept value (a build number after the version)
//             production  `pinned`, read only
import { concourseCi, section } from "./section.ts";
import type { Raw } from "./section.ts";
import type { FakeGh, GhReply } from "./fake-gh.ts";

export const REPO = "acme/deploy-control";
export const STAGING_FILE = "clusters/staging/checkout/chart.version";
export const PRODUCTION_FILE = "clusters/production/checkout/chart.version";
export const QA_CHART = "clusters/qa/checkout/chart.yaml";
export const QA_IMAGE = "clusters/qa/checkout/image.txt";

export const BASE_SHA = "4d5e6f70123456789abcdef0123456789abcdef0";
export const BRANCH_SHA = "0a1b2c3d123456789abcdef0123456789abcdef0";
export const COMMIT_SHA = "9f8e7d6c123456789abcdef0123456789abcdef0";

export const VERSION = "^(?:\\d+\\.\\d+\\.\\d+|0\\.0\\.0-pr-[A-Za-z0-9._-]+-[0-9a-f]{7})$";
export const HOLDER = "(?:^|-)(?<ticket>PROJ-\\d+)(?:-|$)";

/** The `pin` deploy of staging: one file, the whole line is the version. */
export function pinDeploy(more: Raw = {}): Raw {
    return {
        method: "pin",
        repo: REPO,
        base: "main",
        pins: [{ file: STAGING_FILE, line: "^(?<version>\\S+)$", write: "{version}" }],
        version: VERSION,
        ticket: "^PROJ-\\d+$",
        holder: HOLDER,
        branch: "deploy/{ticket}-{environment}-{service}",
        title: "{ticket}: deploy {service} {version} to {environment}",
        merge: "person",
        apply: "job",
        ...more,
    };
}

/** The `pin` deploy of qa: two files, one of them a YAML line with a build number kept from the current line. */
export function qaDeploy(more: Raw = {}): Raw {
    return pinDeploy({
        pins: [
            {
                file: QA_CHART,
                line: "^chartVersion: (?<version>\\S+)  # (?<build>build-\\d+)$",
                write: "chartVersion: {version}  # {build}",
            },
            {
                file: QA_IMAGE,
                line: "^image=registry\\.example\\.test/checkout:(?<version>\\S+)$",
                write: "image=registry.example.test/checkout:{version}",
            },
        ],
        values: { build: "^build-\\d+$" },
        ...more,
    });
}

/** The `pinned` entry of production. */
export function pinnedProduction(more: Raw = {}): Raw {
    return {
        repo: REPO,
        base: "main",
        pins: [{ file: PRODUCTION_FILE, line: "^(?<version>\\S+)$" }],
        version: VERSION,
        holder: HOLDER,
        ...more,
    };
}

const KUBERNETES = { context: "test-cluster", namespace: "checkout-staging", selector: "app=checkout" };

/** The default section and the service `checkout`. */
export function pinSection(options: { runtime?: boolean; staging?: Raw; production?: Raw | null } = {}): Raw {
    const raw = section();
    (raw.services as Record<string, Raw>).checkout = {
        repo: "acme/checkout",
        environments: {
            staging: {
                deploy: pinDeploy(),
                job: concourseCi({ job: "checkout-staging" }),
                ...(options.runtime === true ? { runtime: { kubernetes: KUBERNETES } } : {}),
                ...options.staging,
            },
            qa: { deploy: qaDeploy(), job: concourseCi({ job: "checkout-qa" }) },
            ...(options.production === null
                ? {}
                : {
                      production: {
                          pinned: pinnedProduction(),
                          health: "https://checkout.example.com/health",
                          ...options.production,
                      },
                  }),
        },
    };
    return raw;
}

// ---- what the fake gh answers --------------------------------------------------------------------------------------------

export const fileReply = (text: string, sha = "blob0001"): GhReply => ({
    json: { type: "file", encoding: "base64", content: Buffer.from(text).toString("base64"), sha, size: text.length },
});

export interface CommitSpec {
    author?: string;
    date?: string;
    message?: string;
    sha?: string;
}

export const commitReply = (spec: CommitSpec = {}): GhReply => ({
    json: [
        {
            sha: spec.sha ?? COMMIT_SHA,
            commit: {
                author: { name: spec.author ?? "A. Person", date: spec.date ?? "2026-11-01T10:10:25Z" },
                message:
                    spec.message ??
                    "PROJ-41: deploy checkout 0.0.0-pr-feature-PROJ-41-1a2b3c4 to staging (#88)\n\nbody",
            },
            author: { login: "aperson" },
        },
    ],
});

export const refReply = (sha: string): GhReply => ({ json: { ref: "refs/heads/x", object: { sha, type: "commit" } } });
export const NOT_FOUND: GhReply = { status: 404, json: { message: "Not Found" } };

export interface PullSpec {
    number: number;
    branch: string;
    title?: string;
    author?: string;
    fork?: boolean;
    draft?: boolean;
}

export const pullsReply = (pulls: readonly PullSpec[]): GhReply => ({
    json: pulls.map((pull) => ({
        number: pull.number,
        title: pull.title ?? `title of ${pull.number}`,
        html_url: `https://github.com/${REPO}/pull/${pull.number}`,
        draft: pull.draft ?? false,
        user: { login: pull.author ?? "aperson" },
        head: {
            ref: pull.branch,
            sha: BRANCH_SHA,
            repo: { full_name: pull.fork === true ? "someone/deploy-control" : REPO },
        },
    })),
});

/** The path a read of a file asks for: what a fixture's `has` names. */
export const contents = (file: string, ref = "main"): string => `contents/${file}?ref=${ref}`;
export const commitsOf = (file: string): string => `commits?path=${encodeURIComponent(file)}&sha=main`;
export const refOf = (branch: string): string => `git/ref/heads/${branch}`;

/** Answers for `gh api`: a file at main, its last commit, main's tip, and no pin branch or open pull request yet. */
export function answerFile(
    gh: FakeGh,
    file: string,
    text: string,
    options: { commit?: CommitSpec | null; sha?: string } = {},
): void {
    gh.on("api", fileReply(text, options.sha), [contents(file)]);
    if (options.commit !== null) gh.on("api", commitReply(options.commit), [commitsOf(file)]);
}

export function answerRepository(
    gh: FakeGh,
    options: { pulls?: readonly PullSpec[]; branches?: Record<string, string | null> } = {},
): void {
    gh.on("api", refReply(BASE_SHA), [refOf("main")]);
    for (const [branch, sha] of Object.entries(options.branches ?? {})) {
        gh.on("api", sha === null ? NOT_FOUND : refReply(sha), [refOf(branch)]);
    }
    gh.on("api", pullsReply(options.pulls ?? []), ["pulls?state=open&base=main"]);
}

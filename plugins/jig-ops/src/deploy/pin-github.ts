// The reads of the `pin` method, from GitHub through `gh api`: a file at a branch, the last commit that touched it, a
// branch's tip, and the open pull requests into the branch that deploys. gh keeps its own sign-in. The repository, the
// branch and the path come from the catalog, which checked their characters; each path segment is encoded anyway.
//
// Every text from GitHub that reaches a message is cleaned of terminal sequences and cut: a commit message or a pull
// request title is written by someone else.
import { apiGet } from "../ci/gh.ts";
import type { ApiResponse } from "../ci/gh.ts";
import { clean, isObject, oneLine, str } from "../values.ts";

/** The most a pin file may hold: GitHub's contents API gives a file up to 1 MB in the reply. */
const MAX_FILE_BYTES = 1_000_000;
/** The most open pull requests read for a branch, one page. */
export const PULL_PAGE = 100;

export interface Reads {
    signal?: AbortSignal | undefined;
}

/** A file of the repository at a branch: its text, and the blob sha a write would name. */
export interface FileAt {
    text: string;
    sha: string;
}

/** The last commit on a branch that touched a file. */
export interface Commit {
    sha: string;
    author: string;
    /** When it was made (the author's date), in ms, or undefined when GitHub gave none that reads. */
    at: number | undefined;
    /** The first line of its message. */
    subject: string;
    /** The pull request that made it, from the `(#12)` that a squash merge ends the subject with. */
    pr: number | undefined;
}

export interface PullRequest {
    number: number;
    title: string;
    url: string;
    draft: boolean;
    /** The branch the pull request comes from. */
    branch: string;
    /** Whether that branch is in the repository itself and not in a fork. */
    sameRepo: boolean;
    author: string;
    sha: string;
}

function parse(response: ApiResponse): unknown {
    try {
        return JSON.parse(response.body);
    } catch {
        return undefined;
    }
}

/** One GET. A `404` is returned as `undefined`; any other status outside 200 to 299 is an error that says what failed. */
async function get(path: string, what: string, reads: Reads): Promise<unknown> {
    const response = await apiGet(path, { signal: reads.signal });
    if (response.status === 404) return undefined;
    const body = parse(response);
    if (response.status < 200 || response.status > 299) {
        const message = isObject(body) ? oneLine(clean(str(body.message) ?? ""), 120) : "";
        const hint = response.status === 401 ? " (gh is not signed in: run gh auth login yourself)" : "";
        throw new Error(`reading ${what} failed: HTTP ${response.status}${message === "" ? "" : ` ${message}`}${hint}`);
    }
    if (body === undefined) throw new Error(`reading ${what} returned something that is not JSON`);
    return body;
}

const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** A file at a branch, or undefined when the repository, the branch or the file is not there. */
export async function fileAt(repo: string, file: string, ref: string, reads: Reads): Promise<FileAt | undefined> {
    const what = `${file} in ${repo} at ${ref}`;
    const body = await get(`repos/${repo}/contents/${encodePath(file)}?ref=${encodeURIComponent(ref)}`, what, reads);
    if (body === undefined) return undefined;
    if (!isObject(body) || body.type !== "file") throw new Error(`${what} is not a file`);
    const sha = str(body.sha);
    if (sha === undefined) throw new Error(`reading ${what} gave no blob sha`);
    if (body.encoding !== "base64" || typeof body.content !== "string") {
        throw new Error(`${what} is too large to read here (the limit is ${MAX_FILE_BYTES} bytes)`);
    }
    const bytes = Buffer.from(body.content, "base64");
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${what} is too large to read here`);
    if (bytes.includes(0)) throw new Error(`${what} is not a text file`);
    return { text: bytes.toString("utf8"), sha };
}

function commitOf(item: unknown): Commit | undefined {
    if (!isObject(item) || !isObject(item.commit)) return undefined;
    const sha = str(item.sha);
    if (sha === undefined) return undefined;
    const author = isObject(item.commit.author) ? item.commit.author : {};
    const account = isObject(item.author) ? item.author : {};
    const subject = oneLine(clean(str(item.commit.message)?.split("\n")[0] ?? ""), 120);
    const date = typeof author.date === "string" ? Date.parse(author.date) : Number.NaN;
    const pr = /\(#(\d+)\)\s*$/.exec(subject)?.[1];
    return {
        sha,
        author: oneLine(clean(str(author.name) ?? str(account.login) ?? "unknown"), 80),
        at: Number.isFinite(date) ? date : undefined,
        subject,
        pr: pr === undefined ? undefined : Number(pr),
    };
}

/** The last commit on `ref` that touched `file`, or undefined when none did. */
export async function lastCommit(repo: string, file: string, ref: string, reads: Reads): Promise<Commit | undefined> {
    const what = `the commits of ${file} in ${repo}`;
    const path = `repos/${repo}/commits?path=${encodeURIComponent(file)}&sha=${encodeURIComponent(ref)}&per_page=1`;
    const body = await get(path, what, reads);
    if (!Array.isArray(body)) return undefined;
    return commitOf(body[0]);
}

/** The commit a branch points at, or undefined when there is no such branch. */
export async function branchTip(repo: string, branch: string, reads: Reads): Promise<string | undefined> {
    const what = `the branch ${branch} of ${repo}`;
    const body = await get(`repos/${repo}/git/ref/heads/${encodePath(branch)}`, what, reads);
    if (!isObject(body) || !isObject(body.object)) return undefined;
    return str(body.object.sha);
}

/** The open pull requests into `base`: one page, the newest first. */
export async function openPullRequests(repo: string, base: string, reads: Reads): Promise<PullRequest[]> {
    const what = `the open pull requests of ${repo}`;
    const path = `repos/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=${PULL_PAGE}`;
    const body = await get(path, what, reads);
    if (!Array.isArray(body)) return [];
    return body.flatMap((item): PullRequest[] => {
        if (!isObject(item) || typeof item.number !== "number" || !isObject(item.head)) return [];
        const branch = str(item.head.ref);
        const sha = str(item.head.sha);
        if (branch === undefined || sha === undefined) return [];
        const from = isObject(item.head.repo) ? str(item.head.repo.full_name) : undefined;
        return [
            {
                number: item.number,
                title: oneLine(clean(str(item.title) ?? ""), 120),
                url: str(item.html_url) ?? "",
                draft: item.draft === true,
                branch,
                sameRepo: from !== undefined && from.toLowerCase() === repo.toLowerCase(),
                author: oneLine(clean(isObject(item.user) ? (str(item.user.login) ?? "") : ""), 60),
                sha,
            },
        ];
    });
}

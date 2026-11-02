// `search` with `commented`: the issues a person commented on in some days. Jira has no such query of its own (only an app,
// ScriptRunner, adds one), so the tool finds candidate issues with the caller's JQL and then reads their comments. The
// comments are the truth: a candidate is a match only when one of its comments is by that person and was created in the
// window. ScriptRunner, where the site has it, only makes the list of candidates short.
import { commentOf, commentPage, search, whoAmI } from "./api.ts";
import type { Comment, Env, SearchPage } from "./api.ts";
import { JiraError, LostReplyError, TOO_LARGE } from "./http.ts";
import { andClauses, commentedClause, updatedSince } from "./jql.ts";
import type { CommentedFilter } from "./params.ts";
import { arr, errorMessage, InputError, int, obj, oneLine, sameUser, str, userId, userNamed } from "./values.ts";
import type { Obj, User } from "./values.ts";
import { inWindow, shiftDay, windowOf } from "./window.ts";
import type { Window } from "./window.ts";

/** The most issues one search checks comment by comment. More is refused, with a message about narrowing the query. */
export const MAX_CANDIDATES = 500;
/** How many issues' comments are read at the same time. */
export const COMMENT_READS_AT_ONCE = 4;
/** Candidates per page of the search, and comments per page of one issue's thread. */
const CANDIDATE_PAGE = 50;
const COMMENT_PAGE = 100;
/** Failed comment reads that make a search give up, once they are also more than half of the reads made. */
const GIVE_UP_AFTER = 3;
/**
 * Jira reads a date in `updated >= "2026-10-01"` in the time zone of the account that searches, and the window is in the
 * zone of this machine. A day of slack keeps an issue out of the candidates only when it really was not touched.
 */
const UPDATED_MARGIN_DAYS = 1;
/**
 * ScriptRunner's documentation does not say whether `after` and `before` take their day in or out, and it reads a time in
 * the server's zone. Two days on each side hold the window under either reading; the comment check removes the extra.
 */
const SCRIPTRUNNER_MARGIN_DAYS = 2;

/** A comment that counts: its id and when it was created, as Jira wrote it. */
export interface Hit {
    id: string;
    created: string;
}

/** An issue with at least one comment by the person in the window. */
export interface Match {
    key: string;
    /** The fields the search asked for: the summary, the status and any the call named. */
    fields: Obj;
    hits: Hit[];
}

/** An issue whose comments could not be read, and why. */
export interface Unread {
    key: string;
    why: string;
}

export interface CommentedResult {
    /** Who was asked about, as the result names them: `me (Jane Doe)`, or the text the call gave. */
    who: string;
    asked: CommentedFilter;
    method: "scriptrunner" | "read";
    /** Why ScriptRunner was not what listed the candidates, when it could have been. */
    skipped: string | undefined;
    /** The JQL that listed the candidates. */
    query: string;
    candidates: number;
    matches: Match[];
    unread: Unread[];
}

function cancelled(): Error {
    return new Error("jira search: cancelled before every comment was read");
}

/** True once the call was cancelled. (A function, so that a check made twice is not narrowed away.) */
const stopped = (env: Env): boolean => env.signal?.aborted === true;

// ---- who ----------------------------------------------------------------------------------------------------------------

/** The person asked about. "me" is whoever is signed in: `GET /myself` says, or else `jira.me` does. */
async function resolveWho(env: Env, by: string): Promise<{ user: User; label: string }> {
    if (by.toLowerCase() !== "me") return { user: userNamed(by), label: by };
    const who = await whoAmI(env);
    if (who.user !== undefined && userId(who.user) !== "") {
        return { user: who.user, label: `me (${who.user.displayName})` };
    }
    const { me } = env.settings;
    if (me === undefined) {
        const why = who.user === undefined ? who.why : "it named no account";
        throw new InputError(
            `jira search: commented.by "me" needs to know who is signed in, and ${why}. Set "me" in the jira section ` +
                "of jig.json to your account id (Jira Cloud) or user name (Data Center), or give the person in commented.by",
        );
    }
    return { user: userNamed(me), label: "me" };
}

// ---- candidates ---------------------------------------------------------------------------------------------------------

/** Picks the comments that count out of a whole thread: by the person, created in the window. */
type Judge = (comments: readonly Comment[]) => Hit[];

interface Candidate {
    key: string;
    fields: Obj;
    /** What the thread holds, when Jira sent all of it with the issue. Undefined when the thread must be read. */
    hits: Hit[] | undefined;
}

/** Judges the comments Jira embedded in an issue, if it embedded them all. A list short of its `total`, or with none, is not. */
function judgeEmbedded(value: unknown, judge: Judge): Hit[] | undefined {
    const embedded = obj(value);
    if (typeof embedded.total !== "number") return undefined;
    const comments = arr(embedded.comments).map(commentOf);
    return comments.length >= int(embedded.total) ? judge(comments) : undefined;
}

/** A candidate keeps no comment text: a thread is judged as soon as it is here, and only what it holds for the person stays. */
function candidateOf(issue: Obj, judge: Judge): Candidate {
    const fields = obj(issue.fields);
    return {
        key: str(issue.key),
        fields: Object.fromEntries(Object.entries(fields).filter(([name]) => name !== "comment")),
        hits: judgeEmbedded(fields.comment, judge),
    };
}

function tooMany(count: number | undefined, jql: string, from: string | undefined): InputError {
    const many = count === undefined ? `More than ${MAX_CANDIDATES} issues` : `${count} issues`;
    const later = from === undefined ? "give commented.from" : "move commented.from later";
    return new InputError(
        `jira search: ${many} match ${oneLine(jql, 160)}, which is too many to check comment by comment ` +
            `(the most is ${MAX_CANDIDATES}). Narrow the JQL (one project, component, status or assignee), ` +
            `or ${later}: only issues updated since that day are checked.`,
    );
}

/** One page of candidates. Where the comments make the answer too large to read, the page is asked for again without them. */
async function candidatePage(
    env: Env,
    jql: string,
    fields: readonly string[],
    page: string | undefined,
    embed: { on: boolean },
): Promise<SearchPage> {
    try {
        const asked = embed.on ? [...fields, "comment"] : fields;
        return await search(env, { jql, fields: asked, limit: CANDIDATE_PAGE, page });
    } catch (error) {
        if (!embed.on || !(error instanceof LostReplyError) || error.message !== TOO_LARGE) throw error;
        embed.on = false;
        return candidatePage(env, jql, fields, page, embed);
    }
}

/** What one search needs to list its candidates, whichever way it lists them. */
interface Ask {
    /** The caller's JQL. */
    jql: string;
    /** The conditions on `updated` the first day adds. */
    since: readonly string[];
    who: User;
    filter: CommentedFilter;
    /** Fields to fetch for the matches, besides the summary and the status. */
    extraFields: readonly string[];
    judge: Judge;
}

/** Every issue the query finds, up to the most one search checks. */
async function candidatesOf(env: Env, jql: string, ask: Ask): Promise<Candidate[]> {
    const { judge, filter } = ask;
    const from = filter.from;
    const fields = ["summary", "status", ...ask.extraFields];
    const embed = { on: true };
    const found = new Map<string, Candidate>();
    let page: string | undefined;
    do {
        if (stopped(env)) throw cancelled();
        const got = await candidatePage(env, jql, fields, page, embed);
        if (got.total !== undefined && got.total > MAX_CANDIDATES) throw tooMany(got.total, jql, from);
        for (const issue of got.issues) found.set(str(issue.key), candidateOf(issue, judge));
        if (found.size > MAX_CANDIDATES) throw tooMany(undefined, jql, from);
        page = got.next;
    } while (page !== undefined);
    return [...found.values()];
}

// ---- the exact check ----------------------------------------------------------------------------------------------------

/** Every comment of an issue, oldest first, a page at a time. */
async function allComments(env: Env, key: string): Promise<Comment[]> {
    const comments = new Map<string, Comment>();
    for (;;) {
        const before = comments.size;
        const page = await commentPage(env, key, before, COMMENT_PAGE);
        for (const comment of page.comments) comments.set(comment.id, comment);
        // An empty page, or one with nothing new (a thread that changed while it was read), ends it.
        if (comments.size >= page.total || comments.size === before) return [...comments.values()];
    }
}

/** The judge for a person and a window: the comments by that person that were created in it. */
function judging(who: User, window: Window): Judge {
    return (comments) =>
        comments
            .filter((comment) => sameUser(comment.author, who) && inWindow(comment.created, window))
            .map(({ id, created }) => ({ id, created }));
}

/** Runs `work` on each item, `size` at a time, until the items or `stop` run out. */
async function inPool<T>(
    items: readonly T[],
    size: number,
    stop: () => boolean,
    work: (item: T) => Promise<void>,
): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length && !stop()) await work(items[next++] as T);
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * The candidates with a comment the judge counts, in the candidates' order. A thread Jira sent whole was judged already; the
 * others are read, a few at a time. An issue that cannot be read is listed and left out of the matches. When most reads
 * fail (at least three, and more than half), the site is not answering and the search stops.
 */
async function checkAll(
    env: Env,
    candidates: readonly Candidate[],
    judge: Judge,
): Promise<{ matches: Match[]; unread: Unread[] }> {
    const hits = new Map<number, Hit[]>();
    const unread: Array<Unread & { index: number }> = [];
    const toRead: number[] = [];
    candidates.forEach((candidate, index) => {
        if (candidate.hits === undefined) toRead.push(index);
        else hits.set(index, candidate.hits);
    });

    let attempts = 0;
    const givenUp = (): boolean => unread.length >= GIVE_UP_AFTER && unread.length * 2 > attempts;
    await inPool(toRead, COMMENT_READS_AT_ONCE, givenUp, async (index) => {
        const { key } = candidates[index] as Candidate;
        if (stopped(env)) throw cancelled();
        try {
            hits.set(index, judge(await allComments(env, key)));
        } catch (error) {
            // A request that stopped because the call was cancelled is not a failure of that issue.
            if (stopped(env)) throw cancelled();
            unread.push({ index, key, why: oneLine(errorMessage(error), 140) });
        }
        attempts++;
    });
    unread.sort((a, b) => a.index - b.index);
    if (givenUp()) {
        const first = unread.slice(0, 2).map(({ key, why }) => `${key}: ${why}`);
        throw new Error(
            `jira search: the comments of ${unread.length} of ${attempts} issues could not be read, so the search stopped ` +
                `(${first.join("; ")}). Try again, or narrow the JQL.`,
        );
    }
    const matches = candidates.flatMap((candidate, index): Match[] => {
        const found = hits.get(index) ?? [];
        return found.length === 0 ? [] : [{ key: candidate.key, fields: candidate.fields, hits: found }];
    });
    return { matches, unread: unread.map(({ key, why }) => ({ key, why })) };
}

// ---- ScriptRunner -------------------------------------------------------------------------------------------------------

/** Jira's answer when a query names `issueFunction`, or the function, and the site has neither. */
function noScriptRunner(error: unknown): boolean {
    return (
        error instanceof JiraError &&
        error.status === 400 &&
        /issueFunction|function ['"]?commented['"]? (does not exist|is not supported|not found)/i.test(error.message)
    );
}

/** Candidates from ScriptRunner's `commented()`, or the reason they were not asked for or not had. */
type Tried = { candidates: Candidate[]; query: string } | { skipped: string | undefined };

/**
 * Lists the candidates with ScriptRunner when `commentSearch` allows it. In `auto` the first search on a site tries, and a
 * site that answers that it has no such function is remembered for the session; a refused query only falls back for this
 * call. In `scriptrunner` nothing falls back. In `read` nothing is tried.
 */
async function tryScriptRunner(env: Env, ask: Ask): Promise<Tried> {
    const { who, filter } = ask;
    const mode = env.settings.commentSearch;
    if (mode === "read") return { skipped: undefined };
    if (mode === "auto" && env.session.scriptRunner === "missing") {
        return { skipped: "ScriptRunner's commented() is not on this Jira (found out earlier in this session)" };
    }
    const clause = commentedClause(
        userId(who),
        filter.from === undefined ? undefined : shiftDay(filter.from, -SCRIPTRUNNER_MARGIN_DAYS),
        filter.to === undefined ? undefined : shiftDay(filter.to, SCRIPTRUNNER_MARGIN_DAYS),
    );
    if (clause === undefined) {
        if (mode === "auto") return { skipped: "the person cannot be written in ScriptRunner's query" };
        throw new InputError(
            'jira search: commentSearch is "scriptrunner", but this person cannot be written in its query ' +
                '(letters, digits and . _ @ : + - only). Use commentSearch "auto" or "read"',
        );
    }
    const query = andClauses(ask.jql, [...ask.since, clause]);
    try {
        const candidates = await candidatesOf(env, query, ask);
        env.session.scriptRunner = "present";
        return { candidates, query };
    } catch (error) {
        const missing = noScriptRunner(error);
        if (missing) env.session.scriptRunner = "missing";
        if (mode === "scriptrunner") {
            if (!missing) throw error;
            throw new InputError(
                `jira search: commentSearch is "scriptrunner", but this Jira does not have its commented() function ` +
                    `(${oneLine(errorMessage(error), 120)}). Use commentSearch "auto" or "read"`,
            );
        }
        if (!(error instanceof JiraError) || error.status !== 400) throw error;
        return {
            skipped: missing
                ? "ScriptRunner's commented() is not on this Jira"
                : `Jira refused ScriptRunner's query (${oneLine(error.message, 100)})`,
        };
    }
}

// ---- the search ---------------------------------------------------------------------------------------------------------

/**
 * The issues of `jql` that `filter.by` commented on in the days of `filter`. The candidates are the issues of `jql` updated
 * since the first day (or, with ScriptRunner, those it lists). They have no upper bound on `updated`: an edit made after the
 * window moves `updated` past it, and the issue is still a match if the comment was made inside it.
 */
export async function commentedSearch(
    env: Env,
    jql: string,
    filter: CommentedFilter,
    extraFields: readonly string[],
): Promise<CommentedResult> {
    const { user, label } = await resolveWho(env, filter.by);
    const since = filter.from === undefined ? [] : [updatedSince(shiftDay(filter.from, -UPDATED_MARGIN_DAYS))];
    const judge = judging(user, windowOf(filter.from, filter.to));
    const ask: Ask = { jql, since, who: user, filter, extraFields, judge };

    const tried = await tryScriptRunner(env, ask);
    const method = "candidates" in tried ? "scriptrunner" : "read";
    const query = andClauses(jql, since);
    const listed = "candidates" in tried ? tried : { query, candidates: await candidatesOf(env, query, ask) };
    const checked = await checkAll(env, listed.candidates, judge);
    return {
        who: label,
        asked: filter,
        method,
        skipped: "skipped" in tried ? tried.skipped : undefined,
        query: listed.query,
        candidates: listed.candidates.length,
        ...checked,
    };
}

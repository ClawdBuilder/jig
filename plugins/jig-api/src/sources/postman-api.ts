// The Postman API, as the Postman cloud source calls it: one GET with the API key, carried by the sending engine, so a company
// transport or sign-in service carries it like any other request and the key is read by jig-core at the moment it is sent. The
// key is never in a message or an error, whatever the service or a transport says.
//
// Two uses: `/api refresh` fetches a collection and its environments (postman-cloud.ts), and the `postman-environments` action
// lists the environments the key can see, by name and id only (`listEnvironments`). The list answer of the API carries no
// variables, and only the name, id, owner and time of each environment are read from it.
// API: https://learning.postman.com/api-docs/api-reference/environments/get-all-environments
import { sealed } from "../engine/plan.ts";
import type { Plan } from "../engine/plan.ts";
import { isObject, oneLine } from "../engine/values.ts";
import { LostReplyError, NotSentError } from "../engine/wire.ts";
import type { CloudConfig } from "./postman-cloud.ts";
import type { RefreshDeps } from "./source.ts";

/** The hosts of the Postman API, by region. A key is sent to these and to nothing else. */
const API_HOSTS = { us: "https://api.postman.com", eu: "https://api.eu.postman.com" } as const;

/** The shape of a Postman API key, removed from anything a message could repeat from a transport. */
const KEY_SHAPE = /PMAK-[A-Za-z0-9-]{10,}/g;

/** The largest list of environments read: a list is small, so a larger answer is not one. */
const LIST_MAX_BYTES = 4 * 1024 * 1024;
/** The most environments listed. */
export const LIST_LIMIT = 200;
/** A workspace id: letters, digits and `-`, as Postman's ids are. */
export const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;

/** What the service answered, in a few words that never repeat its own: a key can be echoed in an error, a message can be long. */
function whyStatus(status: number): string {
    if (status === 401 || status === 403) return `the API key was not accepted (HTTP ${status})`;
    if (status === 400 || status === 404)
        return `the service does not know it (HTTP ${status}): check the id, and that the key can see it`;
    if (status === 429) return "the service asked for fewer requests (HTTP 429): try again in a minute";
    if (status >= 500) return `the service failed (HTTP ${status})`;
    return `the service answered HTTP ${status}`;
}

export type Fetched = { ok: true; value: unknown } | { ok: false; reason: string };

/** Any text that could hold a key, with the key's shape removed and cut short. */
const cleaned = (text: string): string => oneLine(text.replace(KEY_SHAPE, "[redacted]"), 120);

/** How the fetch is carried: by the company's transport or sign-in service if one is named, else by the network. */
function carriedBy(config: CloudConfig): Plan["signIn"] {
    if (config.transport !== undefined) return { kind: "transport", name: config.transport };
    if (config.signIn !== undefined) return { kind: "service", name: config.signIn };
    return { kind: "none" };
}

/** One GET of the Postman API with the collection's key, read as JSON. A failure is a reason in a few words, never thrown. */
export async function fetchJson(
    config: CloudConfig,
    name: string,
    route: string,
    deps: RefreshDeps,
    signal: AbortSignal | undefined,
    use: { request: string; maxBytes: number },
): Promise<Fetched> {
    const base = deps.serviceUrl ?? API_HOSTS[config.region];
    const plan: Plan = sealed({
        label: `api ${use.request} ${name}`,
        system: `api:${name}`,
        request: use.request,
        collection: name,
        environment: "Postman cloud",
        jigEnvironment: "external",
        method: "GET",
        url: `${base}${route}`,
        // The key is a secret piece: it is read when the request is sent, and removed from whatever comes back.
        headers: [["X-API-Key", [{ secret: "apiKey", reference: config.apiKey }]]],
        body: undefined,
        signIn: carriedBy(config),
        timeoutSec: deps.timeoutSec,
        allowPlainLocal: deps.allowPlainLocal,
        maxAnswerBytes: use.maxBytes,
    });
    try {
        const { answer } = await deps.http.send(plan, signal);
        if (answer.status !== 200) return { ok: false, reason: whyStatus(answer.status) };
        if (answer.cut) return { ok: false, reason: `the answer is larger than ${use.maxBytes / (1024 * 1024)} MiB` };
        if (answer.binary) return { ok: false, reason: "the answer is not text" };
        try {
            return { ok: true, value: JSON.parse(answer.text) as unknown };
        } catch {
            return { ok: false, reason: "the answer is not JSON" };
        }
    } catch (error) {
        if (error instanceof NotSentError) return { ok: false, reason: `${cleaned(error.message)} (nothing was sent)` };
        if (error instanceof LostReplyError) {
            const reason =
                error.reason === "timeout"
                    ? `no answer within ${deps.timeoutSec} s`
                    : `no answer (${cleaned(error.message)})`;
            return { ok: false, reason };
        }
        return { ok: false, reason: "it failed" };
    }
}

/** One environment of the list: what identifies it, and nothing of what it holds. */
export interface EnvironmentEntry {
    name: string;
    /** The id to put in `environments` of a Postman cloud collection: the `uid` (`<owner>-<uuid>`) when the API gives one. */
    id: string;
    owner?: string;
    updatedAt?: string;
}

export type EnvironmentList =
    | { ok: true; environments: EnvironmentEntry[]; more: number }
    | { ok: false; reason: string };

/** A short text from the answer, or undefined: no control characters, cut to `max`. */
function field(value: unknown, max: number): string | undefined {
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    const text = String(value)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim();
    return text === "" ? undefined : text.slice(0, max);
}

/**
 * The environments the collection's key can see, in one workspace when `workspace` is given, by name and id. The values of
 * their variables are never fetched: the list answer has none, and only the fields of `EnvironmentEntry` are read from it.
 */
export async function listEnvironments(
    config: CloudConfig,
    name: string,
    workspace: string | undefined,
    deps: RefreshDeps,
    signal: AbortSignal | undefined,
): Promise<EnvironmentList> {
    const route =
        workspace === undefined ? "/environments" : `/environments?workspace=${encodeURIComponent(workspace)}`;
    const got = await fetchJson(config, name, route, deps, signal, {
        request: "postman-environments",
        maxBytes: LIST_MAX_BYTES,
    });
    if (!got.ok) return got;
    const list = isObject(got.value) ? got.value.environments : undefined;
    if (!Array.isArray(list)) return { ok: false, reason: "the answer is not a list of environments" };
    const environments: EnvironmentEntry[] = [];
    for (const item of list as unknown[]) {
        if (!isObject(item)) continue;
        const label = field(item.name, 60);
        const id = field(item.uid, 100) ?? field(item.id, 100);
        if (label === undefined || id === undefined) continue;
        const owner = field(item.owner, 40);
        const updatedAt = field(item.updatedAt, 40);
        environments.push({
            name: label,
            id,
            ...(owner === undefined ? {} : { owner }),
            ...(updatedAt === undefined ? {} : { updatedAt }),
        });
    }
    environments.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
        ok: true,
        environments: environments.slice(0, LIST_LIMIT),
        more: Math.max(0, environments.length - LIST_LIMIT),
    };
}

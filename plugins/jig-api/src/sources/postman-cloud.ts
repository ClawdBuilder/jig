// Postman's cloud: a collection and its environments kept in a Postman workspace, fetched with an API key to a local copy that the
// rest of the plugin reads like an exported file. Reading (`load`) is synchronous and touches only that copy, because a call must
// be classified before it runs; fetching is the command `/api refresh`, which goes through the sending engine, so a company
// transport or sign-in service carries it like any other request, and the key is read by jig-core at the moment it is sent.
//
// The copy is `<state>/api/postman-cloud/<id>.json`, private to the user (0600). It holds the collection as the API returns it
// (collection format v2.1) and each environment as the API returns it, except that the value of a secret variable is not
// kept. The API key is never in the copy, in a message or in an error. The calls to the API itself are in postman-api.ts.
// API: https://learning.postman.com/api-docs/api-reference/collections/get-collection (and .../environments/get-environment)
import path from "node:path";
import { replaceFileDurably } from "../../../jig-core/src/kit/files.ts";
import { isObject, shortList } from "../engine/values.ts";
import { pathOf } from "../model.ts";
import type { Collection, Environment, Problem, SavedRequest } from "../model.ts";
import { checkReference } from "../reference.ts";
import { apiStateDir, makePrivateDir } from "../state.ts";
import { readFailure, readText, whyNotRead } from "./files.ts";
import { fetchJson, listEnvironments } from "./postman-api.ts";
import { collectionFrom, environmentFrom } from "./postman.ts";
import type { RefreshReport, Refresher, Source } from "./source.ts";

export interface CloudConfig {
    /** The collection's unique id, `<owner>-<uuid>`. */
    cloud: string;
    /** A secret reference for the API key. */
    apiKey: string;
    /** By the name the configuration gives them, to the environment's unique id. */
    environments: ReadonlyArray<readonly [name: string, id: string]>;
    region: "us" | "eu";
    /** A company transport or sign-in service that carries the fetch. At most one. */
    transport?: string;
    signIn?: string;
}

/** As large as a collection file may be elsewhere. */
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENVIRONMENTS = 20;
const ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/;
const NAME = /^[^\u0000-\u001f\u007f]{1,60}$/;
const FIELDS: ReadonlySet<string> = new Set(["cloud", "apiKey", "environments", "region", "transport", "signIn"]);
// ---------------------------------------------------------------------------------------------------------------------
// Configuration

function check(entry: Readonly<Record<string, unknown>>, at: string, errors: string[]): CloudConfig | undefined {
    const before = errors.length;
    for (const key of Object.keys(entry)) {
        if (key === "environments") {
            errors.push(
                `${at}.environments: for a Postman cloud collection this belongs inside postman, as { "Staging": "<environment id>" }`,
            );
        } else if (key !== "postman") {
            errors.push(`${at}.${key}: unknown field`);
        }
    }
    const raw = entry.postman;
    if (!isObject(raw)) return undefined;
    const here = `${at}.postman`;
    for (const key of Object.keys(raw)) if (!FIELDS.has(key)) errors.push(`${here}.${key}: unknown field`);

    const id = (value: unknown, key: string): string | undefined => {
        if (typeof value === "string" && ID.test(value)) return value;
        errors.push(
            `${key}: must be the id of a Postman ${key.endsWith(".cloud") ? "collection" : "environment"} (letters, digits and -)`,
        );
        return undefined;
    };
    let cloud: string | undefined;
    if (raw.cloud === undefined) errors.push(`${here}.cloud: required, the id of the collection`);
    else cloud = id(raw.cloud, `${here}.cloud`);
    let apiKey: string | undefined;
    if (raw.apiKey === undefined)
        errors.push(`${here}.apiKey: required, a secret reference such as pass:postman/api-key`);
    else apiKey = checkReference(raw.apiKey, `${here}.apiKey`, errors);

    const environments: Array<readonly [string, string]> = [];
    if (raw.environments !== undefined) {
        if (!isObject(raw.environments)) {
            errors.push(
                `${here}.environments: must be an object that maps an environment name to the id of the environment in Postman`,
            );
        } else if (Object.keys(raw.environments).length > MAX_ENVIRONMENTS) {
            errors.push(`${here}.environments: at most ${MAX_ENVIRONMENTS} environments`);
        } else {
            for (const [name, value] of Object.entries(raw.environments)) {
                if (!NAME.test(name)) {
                    errors.push(
                        `${here}.environments: an environment name is text of 1 to 60 characters with no control characters`,
                    );
                    continue;
                }
                const found = id(value, `${here}.environments.${name}`);
                if (found !== undefined) environments.push([name, found]);
            }
        }
    }

    let region: "us" | "eu" = "us";
    if (raw.region === "us" || raw.region === "eu") region = raw.region;
    else if (raw.region !== undefined)
        errors.push(`${here}.region: must be "us" or "eu", the region of your Postman data`);

    const named = (key: "transport" | "signIn", what: string): string | undefined => {
        const value = raw[key];
        if (value === undefined) return undefined;
        if (
            typeof value === "string" &&
            value.trim() !== "" &&
            value.length <= 64 &&
            !/[\u0000-\u001f\u007f]/.test(value)
        )
            return value;
        errors.push(`${here}.${key}: must be the name of a ${what}`);
        return undefined;
    };
    const transport = named("transport", "transport");
    const signIn = named("signIn", "sign-in service");
    if (transport !== undefined && signIn !== undefined) errors.push(`${here}: use signIn or transport, not both`);

    if (errors.length > before || cloud === undefined || apiKey === undefined) return undefined;
    return {
        cloud,
        apiKey,
        environments,
        region,
        ...(transport === undefined ? {} : { transport }),
        ...(signIn === undefined ? {} : { signIn }),
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// The local copy

/** What is kept for a collection: the API's own answers. */
interface Copy {
    version: 1;
    fetchedAt: string;
    collection: unknown;
    /** By the name the configuration gives each environment. */
    environments: Record<string, unknown>;
}

const copyFile = (id: string): string => path.join(apiStateDir("postman-cloud"), `${id}.json`);

/** The copy, or undefined when there is none or it cannot be read as one. */
function readCopy(id: string, problems?: Problem[]): Copy | undefined {
    const shown = `${id}.json`;
    let text: string;
    try {
        text = readText(copyFile(id), MAX_BYTES);
    } catch (error) {
        // A copy that does not exist yet is not a problem of the file; the caller says what to run.
        if (problems !== undefined && (error as { code?: unknown }).code !== "ENOENT") {
            problems.push({ file: shown, key: "", message: whyNotRead(error), level: "error" });
        }
        return undefined;
    }
    try {
        const raw = JSON.parse(text) as unknown;
        if (isObject(raw) && raw.version === 1 && isObject(raw.collection)) {
            const fetchedAt = typeof raw.fetchedAt === "string" ? raw.fetchedAt : "";
            return {
                version: 1,
                fetchedAt,
                collection: raw.collection,
                environments: isObject(raw.environments) ? raw.environments : {},
            };
        }
    } catch {
        // Falls through to the problem below.
    }
    problems?.push({
        file: shown,
        key: "",
        message: "is not a copy that this plugin made: run /api refresh to fetch it again",
        level: "error",
    });
    return undefined;
}

/** Writes the copy so that nobody else can read it, and so that a reader, or a crash, never sees half of it or an empty one. */
function writeCopy(id: string, copy: Copy): void {
    const directory = makePrivateDir("postman-cloud");
    replaceFileDurably(path.join(directory, `${id}.json`), JSON.stringify(copy), 0o600);
}

/** A request that uploads a file cannot be run from a copy: the files are not in it. */
function withoutUploads(request: SavedRequest): SavedRequest {
    const body = request.body;
    const uploads =
        body?.kind === "file" || (body?.kind === "form" && body.fields.some((field) => field.kind === "file"));
    return uploads && request.unsupported === undefined
        ? {
              ...request,
              unsupported: "it uploads a file, and a Postman cloud collection has no folder to keep files in",
          }
        : request;
}

function load(config: CloudConfig, name: string): Collection {
    const problems: Problem[] = [];
    const shown = `${config.cloud}.json`;
    const directory = apiStateDir("postman-cloud");
    const copy = readCopy(config.cloud, problems);
    if (copy === undefined) {
        if (problems.length === 0) {
            problems.push({
                file: shown,
                key: "",
                message: `has not been fetched yet: run /api refresh ${name}`,
                level: "error",
            });
        }
        return {
            name,
            root: directory,
            requests: [],
            environments: new Map(),
            variables: new Map(),
            auth: { kind: "none" },
            problems,
        };
    }
    const environments = new Map<string, Environment>();
    for (const [label] of config.environments) {
        const raw = copy.environments[label];
        if (raw === undefined) {
            const message = `the environment has not been fetched yet: run /api refresh ${name}`;
            problems.push({ file: shown, key: label, message, level: "warning" });
            continue;
        }
        const read = environmentFrom(label, shown, raw, problems);
        if (read !== undefined) environments.set(label, read);
    }
    const collection = collectionFrom(name, shown, directory, { collection: copy.collection, environments }, problems);
    return { ...collection, requests: collection.requests.map(withoutUploads) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Fetching

/** An environment as the API returns it, without the value of a secret. Also the names of the secrets that had one. */
function withoutSecretValues(environment: Record<string, unknown>): {
    environment: Record<string, unknown>;
    hidden: string[];
} {
    const hidden: string[] = [];
    const values = Array.isArray(environment.values) ? (environment.values as unknown[]) : [];
    const kept = values.map((item): unknown => {
        if (!isObject(item) || (item.type !== "secret" && item.secret !== true)) return item;
        if (typeof item.key === "string" && item.value !== undefined && item.value !== null && item.value !== "")
            hidden.push(item.key);
        // What is kept of a secret: its name, and that it is one.
        return { key: item.key, value: "", type: "secret", enabled: item.enabled };
    });
    return { environment: { ...environment, values: kept }, hidden };
}

// What changed ---------------------------------------------------------------------------------------------------------

const signature = (request: SavedRequest): string =>
    JSON.stringify([
        request.method,
        request.url,
        request.headers,
        request.body ?? null,
        request.auth,
        [...request.defaults],
        request.scripts,
        request.unsupported ?? null,
    ]);

function requestsOf(name: string, raw: unknown): Map<string, string> {
    const read = collectionFrom(name, "copy", "", { collection: raw, environments: new Map() }, []);
    return new Map(read.requests.map((request) => [pathOf(request), signature(request)] as const));
}

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function changesOfRequests(name: string, before: Copy | undefined, after: unknown): string {
    const now = requestsOf(name, after);
    if (before === undefined) return `${plural(now.size, "request")}, no copy before`;
    const was = requestsOf(name, before.collection);
    const added = [...now.keys()].filter((key) => !was.has(key));
    const removed = [...was.keys()].filter((key) => !now.has(key));
    const changed = [...now].filter(([key, each]) => was.has(key) && was.get(key) !== each).map(([key]) => key);
    const lines = [
        ...(added.length > 0 ? [`added: ${shortList(added, ", ", 100)}`] : []),
        ...(removed.length > 0 ? [`removed: ${shortList(removed, ", ", 100)}`] : []),
        ...(changed.length > 0 ? [`changed: ${shortList(changed, ", ", 100)}`] : []),
    ];
    return lines.length === 0
        ? `${plural(now.size, "request")}, no change`
        : `${plural(now.size, "request")}; ${lines.join("; ")}`;
}

/** The names and values of an environment's variables that are not secret, and the names that are. */
function variablesOf(raw: unknown): Map<string, string> {
    const found = new Map<string, string>();
    const values = isObject(raw) && Array.isArray(raw.values) ? (raw.values as unknown[]) : [];
    for (const item of values) {
        if (!isObject(item) || typeof item.key !== "string" || item.enabled === false) continue;
        found.set(item.key, item.type === "secret" ? "(secret)" : String(item.value ?? ""));
    }
    return found;
}

function changesOfEnvironment(before: unknown, after: unknown): string {
    if (before === undefined) return "new";
    const was = variablesOf(before);
    const now = variablesOf(after);
    const added = [...now.keys()].filter((key) => !was.has(key));
    const removed = [...was.keys()].filter((key) => !now.has(key));
    // Names only: a value could be a token that someone typed into a variable that is not marked secret.
    const changed = [...now].filter(([key, value]) => was.has(key) && was.get(key) !== value).map(([key]) => key);
    const parts = [
        ...(added.length > 0 ? [`added ${shortList(added, ", ", 60)}`] : []),
        ...(removed.length > 0 ? [`removed ${shortList(removed, ", ", 60)}`] : []),
        ...(changed.length > 0 ? [`changed ${shortList(changed, ", ", 60)}`] : []),
    ];
    return parts.length === 0 ? "no change" : parts.join("; ");
}

// ---------------------------------------------------------------------------------------------------------------------

function refresher(config: CloudConfig, name: string): Refresher {
    return {
        async run(deps, signal): Promise<RefreshReport> {
            const before = readCopy(config.cloud);
            const kept = before === undefined ? "Nothing was saved." : "The local copy was not changed.";
            const got = await fetchJson(config, name, `/collections/${config.cloud}`, deps, signal, {
                request: "refresh",
                maxBytes: MAX_BYTES,
            });
            if (!got.ok)
                return { lines: [`${name}: could not fetch the collection: ${got.reason}. ${kept}`], failed: true };
            const collection = isObject(got.value) ? got.value.collection : undefined;
            if (!isObject(collection) || !Array.isArray(collection.item)) {
                return { lines: [`${name}: the answer is not a collection (it has no items). ${kept}`], failed: true };
            }

            const lines: string[] = [];
            let failed = false;
            const environments: Record<string, unknown> = {};
            for (const [label, id] of config.environments) {
                const fetched = await fetchJson(config, name, `/environments/${id}`, deps, signal, {
                    request: "refresh",
                    maxBytes: MAX_BYTES,
                });
                const environment = fetched.ok && isObject(fetched.value) ? fetched.value.environment : undefined;
                if (!fetched.ok || !isObject(environment) || !Array.isArray(environment.values)) {
                    failed = true;
                    const earlier = before?.environments[label];
                    if (earlier !== undefined) environments[label] = earlier;
                    const why = fetched.ok ? "the answer is not an environment" : fetched.reason;
                    lines.push(
                        `  ${label}: could not fetch the environment: ${why}.${earlier === undefined ? "" : " The earlier copy is kept."}`,
                    );
                    continue;
                }
                const stripped = withoutSecretValues(environment);
                environments[label] = stripped.environment;
                lines.push(`  ${label}: ${changesOfEnvironment(before?.environments[label], stripped.environment)}`);
                if (stripped.hidden.length > 0) {
                    const are = stripped.hidden.length === 1 ? "is a secret" : "are secrets";
                    const names = shortList(stripped.hidden, ", ", 60);
                    lines.push(
                        `  ${label}: ${names} ${are} with a value in Postman; the value is not kept, so give it in api.secrets`,
                    );
                }
            }

            try {
                writeCopy(config.cloud, { version: 1, fetchedAt: new Date().toISOString(), collection, environments });
            } catch (error) {
                const why = `the local copy could not be saved (${readFailure(error)}). The copy was not changed.`;
                return { lines: [`${name}: fetched the collection, but ${why}`], failed: true };
            }
            const also =
                config.environments.length === 0 ? "" : ` and ${plural(config.environments.length, "environment")}`;
            const head = `${name}: fetched the collection${also}`;
            return { lines: [head, `  ${changesOfRequests(name, before, collection)}`, ...lines], failed };
        },
    };
}

export const postmanCloud: Source<CloudConfig> = {
    kind: "postman",
    handles: (entry) => isObject(entry.postman),
    check,
    load,
    refresher: (config, name) => refresher(config, name),
    environmentLister: (config, name) => ({
        list: (workspace, deps, signal) => listEnvironments(config, name, workspace, deps, signal),
    }),
};

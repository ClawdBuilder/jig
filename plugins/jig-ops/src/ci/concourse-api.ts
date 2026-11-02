// Concourse's REST API, for the adapter and the watch: the requests they make, what the replies hold, and how a build
// status becomes one of the four words (pass, fail, pending, skipped). The team, pipeline and job are the catalog's; a
// call never names one. A build that is not a build of that job is refused wherever it came from, so a number cannot
// reach another job.
//
// The login is a bearer token that jig-core reads from the secret reference of the catalog. When Concourse refuses it,
// or the reference cannot be read, the message says how the user renews it (`signInHint`). Nothing here signs in.
import { clean, isObject, oneLine } from "../values.ts";
import type { CiContext } from "./adapter.ts";
import { renderEvents } from "./concourse-events.ts";
import type { ConcourseConfig } from "./config.ts";
import { jsonOf } from "./http.ts";
import { bucketOf } from "./model.ts";
import type { Check } from "./model.ts";
import { RequestFailure, sender } from "./request.ts";
import type { Reply, Request, Send } from "./request.ts";

/** One build of a job, as Concourse's JSON holds it. */
export interface Build {
    /** Concourse's own number for the build, unique on the server. The inputs and the events are found by it. */
    id: number;
    /** The build's number in its job: `20`, or `20.1` for a rerun. */
    name: string;
    /** pending, started, succeeded, failed, errored or aborted. */
    status: string;
    /** Milliseconds since the epoch; none while the build has not started, or has not ended. */
    startedAt?: number;
    endedAt?: number;
    /** Who started it by hand. A build a resource started has none. */
    createdBy?: string;
}

/** What the job and its pipeline say about whether a build can run. */
export interface JobState {
    paused: boolean;
    pipelinePaused: boolean;
    /** The job cannot be started by hand. */
    manualTriggerDisabled: boolean;
}

/** An input of a build: the resource and the version it was at. */
export interface BuildInput {
    name: string;
    version: string;
}

export const LOG_BYTES = 8 * 1024 * 1024;

const enc = encodeURIComponent;
const STATUS = /^[a-z_]{1,30}$/;
const BUILD_NAME = /^\d{1,9}(?:\.\d{1,9})?$/;
const MAX_INPUTS = 20;
/**
 * Where a finished build's stream ends. Concourse writes an `end` event and then keeps the connection open until the client
 * lets go, so the request stops when it has read this. The line break in front is never in a data line: a payload is JSON, and
 * JSON writes a line break as two characters.
 */
const END_OF_EVENTS = "\nevent: end\n";

/** Whether the build is still going or waiting to go. */
export function running(build: Build): boolean {
    return build.status === "pending" || build.status === "started";
}

/** A build as a check, so a Concourse build and a Jenkins stage are judged by the same words. */
export function buildCheck(job: string, build: Build): Check {
    let conclusion: string;
    switch (build.status) {
        case "succeeded":
            conclusion = "success";
            break;
        case "pending":
        case "started":
            conclusion = "";
            break;
        case "aborted":
            conclusion = "cancelled";
            break;
        default:
            // failed and errored; a status nobody knows is not a pass.
            conclusion = "failure";
    }
    return {
        name: job,
        bucket: bucketOf(conclusion === "" ? "pending" : "completed", conclusion),
        detail: build.status,
    };
}

/** The page of a build in Concourse's web interface. */
export function buildUrl(config: ConcourseConfig, build: Build): string {
    const job = `${enc(config.team)}/pipelines/${enc(config.pipeline)}/jobs/${enc(config.job)}`;
    return `${config.url}/teams/${job}/builds/${enc(build.name)}`;
}

function seconds(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : undefined;
}

/**
 * A build from Concourse's JSON, or an error. The team, pipeline and job it names must be the catalog's: a build
 * of any other job is refused, however it was asked for. `what` names the request for the message.
 */
export function readBuild(raw: unknown, config: ConcourseConfig, what: string): Build {
    if (!isObject(raw)) throw new Error(`Concourse ${what} returned something that is not a build`);
    const { id, name, status } = raw;
    if (
        typeof id !== "number" ||
        !Number.isSafeInteger(id) ||
        id < 1 ||
        typeof name !== "string" ||
        !BUILD_NAME.test(name) ||
        typeof status !== "string" ||
        !STATUS.test(status)
    ) {
        throw new Error(`Concourse ${what} returned a build in a shape this plugin does not know`);
    }
    if (raw.team_name !== config.team || raw.pipeline_name !== config.pipeline || raw.job_name !== config.job) {
        throw new Error(`Concourse ${what} returned a build that is not a build of ${config.job}, so it was refused`);
    }
    const startedAt = seconds(raw.start_time);
    const endedAt = seconds(raw.end_time);
    const createdBy = typeof raw.created_by === "string" ? oneLine(clean(raw.created_by), 80) : "";
    return {
        id,
        name,
        status,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(endedAt === undefined ? {} : { endedAt }),
        ...(createdBy === "" ? {} : { createdBy }),
    };
}

/** The renewal step the catalog names, as a sentence ending: `renew it with ... in your terminal`. */
function renewal(config: ConcourseConfig): string {
    return config.signInHint === undefined
        ? "renew it yourself in your terminal"
        : `renew it with \`${config.signInHint}\` in your terminal`;
}

/** Concourse did not accept the login. Nothing was done, so a write is not lost. */
function loginRefused(config: ConcourseConfig, status: number): Error {
    return new Error(`Concourse refused the login (HTTP ${status}): ${renewal(config)}, then run the call again.`);
}

/** The reference of the login could not be read (no login, another server, expired): the command said why. */
function loginUnreadable(config: ConcourseConfig, why: string): Error {
    return new Error(`Concourse login could not be read (${why}): ${renewal(config)}, then run the call again.`);
}

export interface ConcourseApi {
    job(): Promise<JobState>;
    /** The newest builds first. */
    builds(limit: number): Promise<Build[]>;
    /** One build by its number in the job (`20`), or undefined when there is none. */
    build(name: string): Promise<Build | undefined>;
    /** One build by Concourse's own number for it, or undefined when there is none. */
    buildById(id: number): Promise<Build | undefined>;
    /** The resources the build ran with, or undefined when Concourse has none to show. */
    inputs(build: Build): Promise<BuildInput[] | undefined>;
    /** The log of a finished build, as text. A running build's stream does not end, so it is not asked for. */
    log(build: Build): Promise<string>;
    /** Starts a build, once. The reply is returned whatever its status, except a refused login. */
    trigger(): Promise<Reply>;
}

export function concourseApi(config: ConcourseConfig, ctx: CiContext): ConcourseApi {
    const raw = sender(
        { system: "concourse", url: config.url, auth: config.auth },
        { signal: ctx.signal, timeoutMs: ctx.timeoutMs },
    );
    const send: Send = async (request) => {
        try {
            return await raw(request);
        } catch (error) {
            if (error instanceof RequestFailure && error.kind === "auth") throw loginUnreadable(config, error.message);
            throw error;
        }
    };
    const pipeline = `/api/v1/teams/${enc(config.team)}/pipelines/${enc(config.pipeline)}`;
    const job = `${pipeline}/jobs/${enc(config.job)}`;

    /** A reply that is not a refused login. */
    const checked = (reply: Reply): Reply => {
        if (reply.status === 401 || reply.status === 403) throw loginRefused(config, reply.status);
        return reply;
    };
    const get = async (path: string, accept = "application/json", more: Partial<Request> = {}): Promise<Reply> =>
        checked(await send({ method: "GET", path, headers: { accept }, ...more }));
    const json = <T>(reply: Reply, what: string): T => {
        if (reply.status === 404) {
            throw new Error(
                `Concourse ${what} failed: HTTP 404 (not found: check the team, pipeline and job in the catalog, ` +
                    "and that the account can see them)",
            );
        }
        return jsonOf<T>("Concourse", what, reply);
    };
    const one = async (path: string, what: string): Promise<Build | undefined> => {
        const reply = await get(path);
        return reply.status === 404 ? undefined : readBuild(json(reply, what), config, what);
    };

    return {
        async job() {
            const found = json<unknown>(await get(job), "GET job");
            const pipelineFound = json<unknown>(await get(pipeline), "GET pipeline");
            const flag = (value: unknown, name: string) => isObject(value) && value[name] === true;
            return {
                paused: flag(found, "paused"),
                pipelinePaused: flag(pipelineFound, "paused"),
                manualTriggerDisabled: flag(found, "disable_manual_trigger"),
            };
        },
        async builds(limit) {
            const found = json<unknown>(await get(`${job}/builds?limit=${limit}`), "GET builds");
            if (!Array.isArray(found)) throw new Error("Concourse GET builds returned something that is not a list");
            return found.map((item) => readBuild(item, config, "GET builds"));
        },
        build: (name) => one(`${job}/builds/${enc(name)}`, `GET build ${name}`),
        buildById: (id) => one(`/api/v1/builds/${id}`, `GET build ${id}`),
        async inputs(build) {
            const reply = await get(`/api/v1/builds/${build.id}/resources`);
            if (reply.status === 404) return undefined;
            const found = json<unknown>(reply, `GET build ${build.name} resources`);
            const inputs = isObject(found) && Array.isArray(found.inputs) ? found.inputs : [];
            return inputs.slice(0, MAX_INPUTS).flatMap((input: unknown) => {
                if (!isObject(input) || typeof input.name !== "string") return [];
                const version = isObject(input.version) ? input.version : {};
                const pairs = Object.entries(version)
                    .filter((pair): pair is [string, string] => typeof pair[1] === "string")
                    .map(([key, value]) => `${key}=${oneLine(clean(value), 64)}`);
                return [{ name: oneLine(clean(input.name), 80), version: pairs.join(", ") }];
            });
        },
        async log(build) {
            const reply = await get(`/api/v1/builds/${build.id}/events`, "text/event-stream", {
                maxBytes: LOG_BYTES,
                stopAt: END_OF_EVENTS,
            });
            if (reply.status === 404) throw new Error(`build ${build.name} has no log`);
            if (reply.status < 200 || reply.status > 299) {
                throw new Error(`Concourse GET build ${build.name} events failed: HTTP ${reply.status}`);
            }
            return renderEvents(reply.body);
        },
        async trigger() {
            return checked(await send({ method: "POST", path: `${job}/builds` }));
        },
    };
}

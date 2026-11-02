// The Concourse adapter: the builds of one job, through Concourse's REST API. Reads are plain; `trigger` starts the job
// with no ref and no parameters, previewed and sent once.
//
// A Concourse job has no commit, branch or pull request of its own, so a build is found by its number or as the newest.
// Concourse has no stages to name, so a watch follows one build to its end. There is no rerun: a build of a job is
// started again by starting the job. The login is a token that jig-core reads from a secret reference; nothing here, and
// nothing in this plugin, signs in or runs a Concourse command.
import type { CiService } from "../catalog.ts";
import { digest, duration, InputError, plural } from "../values.ts";
import type { Outcome } from "../values.ts";
import type { ActionTable, CiAdapter, CiContext, CiSystemInfo, Params, Plan, WatchPlan } from "./adapter.ts";
import { buildCheck, buildUrl, concourseApi, readBuild, running } from "./concourse-api.ts";
import type { Build, ConcourseApi } from "./concourse-api.ts";
import { pollConcourse, titleOf } from "./concourse-watch.ts";
import type { ConcourseSpec, ConcourseState } from "./concourse-watch.ts";
import type { ConcourseConfig } from "./config.ts";
import { httpFailure } from "./http.ts";
import { selectLog } from "./logs.ts";
import { afterLostReply } from "./lost.ts";
import { count } from "./model.ts";
import { RequestFailure } from "./request.ts";

export const TABLE: ActionTable = {
    status: { optional: ["run_id"] },
    runs: { optional: ["state", "limit"] },
    run: { optional: ["run_id"] },
    log: { optional: ["run_id", "tail", "grep"] },
    trigger: {},
    watch: { optional: ["run_id", "finish"] },
};

/** What `runs` can filter by: Concourse's own build statuses. */
const STATES = ["pending", "started", "succeeded", "failed", "errored", "aborted"];
/** The most builds `runs` lists. */
const MAX_RUNS = 20;
/** The builds read to find the newest failed one. */
const LOOK_BACK = 20;
/** The builds read after a state filter, since Concourse cannot filter by status. */
const FILTER_WINDOW = 100;
const FAILED = new Set(["failed", "errored", "aborted"]);

const NOT_STARTED =
    "Not started as far as Concourse shows now; it may still appear: run `ci runs` in a minute before triggering again.";

/** `2026-11-01 09:12 UTC`. */
function utc(ms: number): string {
    return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The Concourse entry of a service. A function declaration cannot keep the narrowing of a check made outside it. */
function concourseConfig(service: CiService): ConcourseConfig {
    if (service.ci.system !== "concourse") throw new Error(`${service.name} is not a Concourse service`);
    return service.ci;
}

function concourse(service: CiService, ctx: CiContext): CiAdapter {
    const config = concourseConfig(service);
    const api: ConcourseApi = concourseApi(config, ctx);
    const job = config.job;

    /** The build a call means: the number, else the newest. A job that was never built has none, and says so. */
    async function buildOf(params: Params): Promise<Build> {
        const found = params.run_id !== undefined ? await api.build(String(params.run_id)) : (await api.builds(1))[0];
        if (found !== undefined) return found;
        throw new Error(
            params.run_id !== undefined ? `${job} has no build ${params.run_id}` : `${job} has no build yet`,
        );
    }

    function headOf(build: Build): string {
        const took =
            build.startedAt !== undefined && build.endedAt !== undefined
                ? `, took ${duration(build.endedAt - build.startedAt)}`
                : "";
        const at = build.startedAt === undefined ? "" : ` (${utc(build.startedAt)})`;
        const by = build.createdBy === undefined ? "" : `, started by ${build.createdBy}`;
        return `build #${build.name} of ${job}: ${build.status}${took}${at}${by}`;
    }

    // ---- status ---------------------------------------------------------------------------------------------------

    async function status(params: Params): Promise<Outcome> {
        const state = await api.job();
        const build = await buildOf(params);
        const check = buildCheck(job, build);
        const paused = state.paused ? `\nThe job ${job} is paused: a build started now will not run.` : "";
        const pipelinePaused = state.pipelinePaused
            ? `\nThe pipeline ${config.pipeline} is paused: a build started now will not run.`
            : "";
        return {
            text: `${headOf(build)}\n${buildUrl(config, build)}${paused}${pipelinePaused}`,
            facts: { ...count([check]), conclusion: build.status },
            details: { build: build.name },
        };
    }

    // ---- runs -----------------------------------------------------------------------------------------------------

    async function runs(params: Params): Promise<Outcome> {
        const wanted = params.state?.toLowerCase();
        if (wanted !== undefined && !STATES.includes(wanted)) {
            throw new InputError(`ci runs: state must be one of ${STATES.join(", ")}`);
        }
        const limit = params.limit ?? MAX_RUNS;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RUNS) {
            throw new InputError(`ci runs: limit must be a whole number from 1 to ${MAX_RUNS} for Concourse`);
        }
        // Concourse cannot filter by status, so ask for a window that may hold what is wanted and cut after.
        const all = await api.builds(wanted === undefined ? limit : FILTER_WINDOW);
        const found = all.filter((build) => wanted === undefined || build.status === wanted).slice(0, limit);
        if (found.length === 0) return { text: `No builds match in ${job}.`, facts: {}, details: { numbers: [] } };
        const lines = found.map((build) =>
            `#${build.name} ${build.status.padEnd(9)} ${build.startedAt === undefined ? "" : utc(build.startedAt)}`.trimEnd(),
        );
        return {
            text: `${job}: ${plural(found.length, "build")}\n${lines.join("\n")}`,
            facts: {},
            details: { numbers: found.map((build) => build.name) },
        };
    }

    // ---- run ------------------------------------------------------------------------------------------------------

    async function run(params: Params): Promise<Outcome> {
        const build = await buildOf(params);
        const inputs = await api.inputs(build);
        const out = [headOf(build), buildUrl(config, build)];
        if (inputs === undefined) out.push("(Concourse shows no inputs for this build)");
        else if (inputs.length === 0) out.push("inputs: none");
        else out.push("inputs:", ...inputs.map((input) => `- ${input.name}: ${input.version}`));
        return { text: out.join("\n"), facts: { conclusion: build.status }, details: { build: build.name } };
    }

    // ---- log ------------------------------------------------------------------------------------------------------

    /** The newest build that failed, errored or was aborted among the latest ones. */
    async function lastFailed(): Promise<Build> {
        const found = (await api.builds(LOOK_BACK)).find((build) => FAILED.has(build.status));
        if (found !== undefined) return found;
        throw new Error(`${job} has no failed build among its last ${LOOK_BACK}; pass run_id`);
    }

    async function log(params: Params): Promise<Outcome> {
        const build = params.run_id === undefined ? await lastFailed() : await buildOf(params);
        if (running(build)) {
            const state = build.status === "pending" ? "waiting to start" : "still running";
            return {
                text: `Build #${build.name} of ${job} is ${state}; its log comes with \`ci watch\`.`,
                facts: {},
                details: { build: build.name },
            };
        }
        const picked = selectLog(await api.log(build), { tail: params.tail, grep: params.grep });
        const head = `Build #${build.name} of ${job} (${build.status}): ${picked.note}`;
        return {
            text: picked.text === "" ? head : `${head}\n${picked.text}`,
            facts: {},
            details: { build: build.name },
        };
    }

    // ---- trigger --------------------------------------------------------------------------------------------------

    async function trigger(): Promise<Plan> {
        const state = await api.job();
        // A paused job or pipeline queues the build and never runs it. Refused as invalid input, so nobody is asked.
        if (state.pipelinePaused) {
            throw new InputError(
                `ci trigger: the pipeline ${config.pipeline} is paused in Concourse, so a build would not run`,
            );
        }
        if (state.paused) throw new InputError(`ci trigger: ${job} is paused in Concourse, so a build would not run`);
        if (state.manualTriggerDisabled) {
            throw new InputError(`ci trigger: ${job} cannot be started by hand (manual triggering is turned off)`);
        }
        const last = (await api.builds(1))[0];
        const lastLine =
            last === undefined
                ? "none yet"
                : `#${last.name} ${last.status}` +
                  (last.startedAt === undefined ? "" : `, started ${utc(last.startedAt)}`) +
                  (last.createdBy === undefined ? "" : ` by ${last.createdBy}`);
        const body = [
            `Service:       ${service.name}`,
            `Job:           ${job} (Concourse, team ${config.team}, pipeline ${config.pipeline})`,
            `Last build:    ${lastLine}`,
            ...(last !== undefined && running(last)
                ? ["A build is running: if the job runs one at a time, this one queues."]
                : []),
            "Sent once. If the reply is lost, the job's builds are read once and nothing is sent again.",
        ].join("\n");
        return {
            preview: {
                summary: `start the job ${job} (Concourse, pipeline ${config.pipeline})`,
                body,
                format: "text",
                fingerprint: digest(
                    "ci trigger",
                    service.name,
                    config.team,
                    config.pipeline,
                    job,
                    last?.id ?? null,
                    last?.status ?? null,
                ),
            },
            send: async () => {
                // A build that was started is a newer one than the last the user saw.
                const lost = (why: string) =>
                    afterLostReply(
                        "Concourse build",
                        why,
                        "Concourse",
                        async () => {
                            const after = await concourseApi(config, { ...ctx, signal: undefined }).builds(5);
                            const newest = after.sort((a, b) => b.id - a.id)[0];
                            return newest !== undefined && newest.id > (last?.id ?? 0)
                                ? `Started build #${newest.name} of ${job} (${newest.status}).`
                                : undefined;
                        },
                        NOT_STARTED,
                    );
                let reply: Awaited<ReturnType<typeof api.trigger>>;
                try {
                    reply = await api.trigger();
                } catch (error) {
                    if (error instanceof RequestFailure && error.lost) return lost(error.message);
                    if (ctx.signal?.aborted) return lost("the call was cancelled");
                    throw error;
                }
                if (reply.status >= 500) return lost(`HTTP ${reply.status}`);
                if (reply.status < 200 || reply.status > 299)
                    throw httpFailure("Concourse", `POST build of ${job}`, reply);
                const started = startedBuild(reply.body);
                return {
                    text:
                        started === undefined
                            ? `Started a build of ${job}.`
                            : `Started build #${started.name} of ${job} (${started.status}).`,
                    facts: { outcome: "started" },
                    details: started === undefined ? {} : { build: started.name },
                };
            },
        };
    }

    /** The build in the reply of a start, when there is one that is a build of this job. */
    function startedBuild(body: string): Build | undefined {
        try {
            return readBuild(JSON.parse(body), config, "POST build");
        } catch {
            return undefined;
        }
    }

    // ---- watch ----------------------------------------------------------------------------------------------------

    async function watch(params: Params): Promise<WatchPlan> {
        const finishName = params.finish ?? "run";
        if (finishName !== "run") {
            throw new InputError(`ci watch: Concourse does not support finish ${finishName}. It supports: run`);
        }
        const spec: ConcourseSpec = { system: "concourse", service: service.name, finish: { kind: "build" } };
        if (params.run_id !== undefined) {
            spec.build = (await buildOf(params)).name;
        } else {
            // A build that is running now is the one to follow. Otherwise the next one that is created.
            const newest = (await api.builds(1))[0];
            if (newest !== undefined && running(newest)) spec.build = newest.name;
            else spec.after = newest?.id ?? 0;
        }
        return { spec, title: titleOf(spec), ends: "the build ends" };
    }

    return {
        status,
        runs,
        run,
        log,
        trigger,
        watch,
        poll: (spec, previous) => {
            if (spec.system !== "concourse") throw new Error(`a ${spec.system} watch cannot be polled as Concourse`);
            const held = previous !== undefined && !("answers" in previous) ? (previous as ConcourseState) : undefined;
            return pollConcourse(api, spec, config, held, ctx);
        },
    };
}

export const CONCOURSE: CiSystemInfo = { system: "concourse", label: "Concourse", table: TABLE, create: concourse };

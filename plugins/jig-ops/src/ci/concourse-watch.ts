// The Concourse half of the CI watch: one build, followed to its end. jig-core's watch engine calls `poll` on a timer,
// saves the state it returns and sends the result to the agent. Concourse has no stages to name, so there is one finish
// line, the build.
//
// The build is found in one of three ways: by its number in the job (`build`), as the first one created after the build
// that was the newest when the watch began (`after`, a number Concourse gave the build), or, for a watch that began
// with a push and so knew nothing of the job, as the first one created after the first poll. The spec holds the name of
// the service and never the address, team, pipeline or job: each poll finds them in the catalog as it is now.
import type { PollOutcome, WatchResult } from "../../../jig-core/src/contract.ts";
import { duration } from "../values.ts";
import type { CiContext } from "./adapter.ts";
import { buildCheck, buildUrl, running } from "./concourse-api.ts";
import type { Build, ConcourseApi } from "./concourse-api.ts";
import type { ConcourseConfig } from "./config.ts";
import type { PlainState } from "./gitlab-watch.ts";
import { selectLog } from "./logs.ts";
import { count } from "./model.ts";

/** What a Concourse watch watches. Plain JSON, because it is saved with the watch. */
export interface ConcourseSpec {
    system: "concourse";
    service: string;
    /** The environment the call named, when it named one: its CI is watched. */
    environment?: string;
    /** The number of the build (`20`), when it is known. */
    build?: string;
    /** Follow the first build created after the build with this Concourse number. 0 when there was none. */
    after?: number;
    /** The commit the build is for, when the push that caused it is known. Only the ci-finished event uses it. */
    sha?: string;
    /** The only finish line there is. */
    finish: { kind: "build" };
}

/** What a Concourse watch remembers between polls. Plain JSON. */
export interface ConcourseState extends PlainState {
    /** The newest build the first poll saw, for a watch that began without one. */
    after?: number;
}

/** The lines of a failed build's log that the end message carries. */
const FAILED_LOG_LINES = 40;
/** How many recent builds are read to find the next one. */
const RECENT = 20;

/** One line naming what is watched, such as "build #12 of orders-api" or "the next build of orders-api". */
export function titleOf(spec: ConcourseSpec): string {
    const of = spec.environment === undefined ? spec.service : `${spec.service} in ${spec.environment}`;
    return spec.build !== undefined ? `build #${spec.build} of ${of}` : `the next build of ${of}`;
}

/** One line for `watch list`: the service, then what it waits for. */
export function describeConcourse(spec: ConcourseSpec): string {
    return `${spec.service}: ${titleOf(spec)}`;
}

/** The build this watch follows, or undefined when none has been created yet. May record the first poll's baseline. */
async function findBuild(api: ConcourseApi, spec: ConcourseSpec, state: ConcourseState): Promise<Build | undefined> {
    if (state.found !== undefined) return api.buildById(state.found);
    if (spec.build !== undefined) return api.build(spec.build);
    const after = spec.after ?? state.after;
    if (after === undefined) {
        state.after = (await api.builds(1))[0]?.id ?? 0;
        return undefined;
    }
    const later = (await api.builds(RECENT)).filter((build) => build.id > after);
    return later.sort((a, b) => a.id - b.id)[0];
}

function where(job: string, build: Build): string {
    return `build #${build.name} of ${job}`;
}

/** What to show of a failed build: the end of its log. A log that cannot be read does not lose the result. */
async function failureDetails(api: ConcourseApi, build: Build): Promise<string | undefined> {
    try {
        const text = selectLog(await api.log(build), { tail: FAILED_LOG_LINES }).text;
        return text.trim() === "" ? undefined : text;
    } catch {
        return undefined;
    }
}

async function evaluate(api: ConcourseApi, config: ConcourseConfig, build: Build): Promise<WatchResult | undefined> {
    if (running(build)) return undefined;
    const check = buildCheck(config.job, build);
    const facts = { ...count([check]), conclusion: build.status };
    const links = [buildUrl(config, build)];
    if (build.status === "succeeded") {
        const took =
            build.startedAt !== undefined && build.endedAt !== undefined
                ? ` in ${duration(build.endedAt - build.startedAt)}`
                : "";
        return { outcome: "passed", summary: `${where(config.job, build)} succeeded${took}`, links, facts };
    }
    const ending = build.status === "aborted" ? "was aborted" : build.status;
    return {
        outcome: "failed",
        summary: `${where(config.job, build)} ${ending}`,
        details: await failureDetails(api, build),
        links,
        facts,
    };
}

/** One poll. A throw is a failed poll: the engine counts three in a row and pauses the watch with one notice. */
export async function pollConcourse(
    api: ConcourseApi,
    spec: ConcourseSpec,
    config: ConcourseConfig,
    previous: ConcourseState | undefined,
    ctx: CiContext,
): Promise<PollOutcome<ConcourseState>> {
    const state: ConcourseState = { polls: (previous?.polls ?? 0) + 1 };
    if (previous?.found !== undefined) state.found = previous.found;
    if (previous?.after !== undefined) state.after = previous.after;
    const wait = ctx.pollSeconds * 1000;
    const build = await findBuild(api, spec, state);
    if (build === undefined) return { state, nextPollMs: wait };
    state.found = build.id;
    const done = await evaluate(api, config, build);
    return done ? { state, done } : { state, nextPollMs: wait };
}

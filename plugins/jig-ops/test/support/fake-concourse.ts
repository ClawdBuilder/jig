// A fake Concourse: the REST API paths that the adapter uses, answering from a world a test changes as it goes. The token
// is checked as a bearer. A POST to the job's builds adds a pending build, as Concourse does, and answers with it. A job
// that is paused or a pipeline that is paused still takes the POST (the adapter refuses before it gets that far).
// Events come as server-sent text in the form Concourse sends (every event wrapped in an `event` block) or in the bare
// form, where the block's own name is the kind.
import type { Answer, Recorded, Responder } from "./fake-server.ts";

export interface CcBuild {
    id: number;
    name: string;
    status: string;
    team_name: string;
    pipeline_name: string;
    job_name: string;
    start_time?: number;
    end_time?: number;
    created_by?: string;
}

export interface CcInput {
    name: string;
    version: Record<string, string>;
}

export type CcEvent =
    | { kind: "log"; payload: string }
    | { kind: "status"; status: string }
    | { kind: "error"; message: string }
    | { kind: "start-task" };

export interface ConcourseWorld {
    team: string;
    pipeline: string;
    job: string;
    /** Whether the headers sign in. Default: a bearer of `TOKEN`. */
    authorized: (headers: Record<string, string>) => boolean;
    /** In any order; the server lists them newest first. */
    builds: CcBuild[];
    paused: boolean;
    pipelinePaused: boolean;
    disableManualTrigger: boolean;
    /** The inputs of a build, by Concourse's number for it. A build without an entry has no resources page. */
    inputs: Record<number, CcInput[]>;
    /** The events of a build, by Concourse's number for it. A build without an entry has no events. */
    events: Record<number, CcEvent[]>;
    /** The form of the events. Concourse's own is `wrapped`. */
    form: "wrapped" | "bare";
    /** Ends a stream with an `end` event, as Concourse does for a finished build. */
    end: boolean;
    /** Keeps the stream open after the last event, as Concourse does until the client lets go. */
    hold: boolean;
    /** How many builds the POSTs started. */
    started: number;
}

/** The token the fake accepts. Built from parts, as every fake credential is. */
export const TOKEN = ["concourse", "bearer", "0123456789abcdef"].join("-");

const SECONDS = Date.parse("2026-11-01T09:12:00Z") / 1000;

export function build(id: number, status: string, more: Partial<CcBuild> = {}): CcBuild {
    const finished = !["pending", "started"].includes(status);
    // Build #N started N * 10 minutes after the first one, and a finished build took 5m02s.
    const started = SECONDS + (id - 100) * 600;
    return {
        id,
        name: String(id - 100),
        status,
        team_name: "main",
        pipeline_name: "deploy",
        job_name: "orders-api-staging",
        ...(status === "pending" ? {} : { start_time: started }),
        ...(finished ? { end_time: started + 302 } : {}),
        ...more,
    };
}

export function concourseWorld(more: Partial<ConcourseWorld> = {}): ConcourseWorld {
    return {
        team: "main",
        pipeline: "deploy",
        job: "orders-api-staging",
        authorized: (headers) => headers.authorization === `Bearer ${TOKEN}`,
        builds: [],
        paused: false,
        pipelinePaused: false,
        disableManualTrigger: false,
        inputs: {},
        events: {},
        form: "wrapped",
        end: true,
        hold: true,
        started: 0,
        ...more,
    };
}

const json = (body: unknown, status = 200): Answer => ({ status, json: body });
const NOT_FOUND: Answer = { status: 404, json: { error: "not found" } };

/** The server-sent text of a build's events. */
export function sse(events: readonly CcEvent[], form: "wrapped" | "bare", end: boolean): string {
    const blocks = events.map((event, index) => {
        const { kind, ...data } = event;
        const payload =
            kind === "log"
                ? { payload: (event as { payload: string }).payload, origin: { id: "step", source: "stdout" }, time: 1 }
                : data;
        if (form === "bare") return `id: ${index}\nevent: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`;
        return `id: ${index}\nevent: event\ndata: ${JSON.stringify({ data: payload, event: kind, version: "5.1" })}\n\n`;
    });
    if (end) blocks.push(`id: ${events.length}\nevent: end\ndata: \n\n`);
    return blocks.join("");
}

export function concourseResponder(world: ConcourseWorld): Responder {
    return (request: Recorded): Answer => {
        if (!world.authorized(request.headers)) return json({ error: "unauthorized" }, 401);
        const sorted = () => [...world.builds].sort((a, b) => b.id - a.id);
        const pipelinePath = `/api/v1/teams/${world.team}/pipelines/${world.pipeline}`;
        const jobPath = `${pipelinePath}/jobs/${world.job}`;

        if (request.path === pipelinePath) {
            return json({ name: world.pipeline, team_name: world.team, paused: world.pipelinePaused });
        }
        if (request.path === jobPath) {
            return json({
                name: world.job,
                team_name: world.team,
                pipeline_name: world.pipeline,
                paused: world.paused,
                disable_manual_trigger: world.disableManualTrigger,
                inputs: [],
            });
        }
        if (request.path === `${jobPath}/builds`) {
            if (request.method === "POST") {
                const id = Math.max(100, ...world.builds.map((b) => b.id)) + 1;
                const created = build(id, "pending", { created_by: "ci-user" });
                world.builds.push(created);
                world.started++;
                return json(created);
            }
            const limit = Number(request.query.get("limit") ?? 100);
            return json(sorted().slice(0, limit));
        }
        const byName = new RegExp(`^${jobPath}/builds/([0-9.]+)$`).exec(request.path);
        if (byName) {
            const named = world.builds.find((b) => b.name === byName[1]);
            return named === undefined ? NOT_FOUND : json(named);
        }
        const byId = /^\/api\/v1\/builds\/(\d+)(?:\/(resources|events))?$/.exec(request.path);
        if (byId) {
            const found = world.builds.find((b) => b.id === Number(byId[1]));
            if (found === undefined) return NOT_FOUND;
            if (byId[2] === "resources") {
                const inputs = world.inputs[found.id];
                return inputs === undefined ? NOT_FOUND : json({ inputs, outputs: [] });
            }
            if (byId[2] === "events") {
                const events = world.events[found.id];
                return events === undefined
                    ? NOT_FOUND
                    : {
                          text: sse(events, world.form, world.end),
                          headers: { "content-type": "text/event-stream" },
                          keepOpen: world.hold,
                      };
            }
            return json(found);
        }
        return NOT_FOUND;
    };
}

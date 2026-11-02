// The parameters of the `deploy` tool, and the checks that turn them into a Call. The version is the only text of a
// call that can reach a command line, and it is checked here to be an image tag. parseCall does no I/O.
import { stringEnum } from "../../../jig-core/src/kit/schema.ts";
import { Type } from "typebox";
import { describeServices, findEnvironment, findService, notSetUp, pinOf } from "../catalog.ts";
import type { Catalog, Environment } from "../catalog.ts";
import type { Target } from "../runtime/kubernetes/config.ts";
import { InputError, isObject, shortList, shown } from "../values.ts";
import { matchesWhole, usesTicket } from "./pin-config.ts";
import type { PinDeploy, PinSource } from "./pin-config.ts";

export const ACTIONS = ["plan", "run", "status", "rollback", "watch"] as const;
export type Action = (typeof ACTIONS)[number];

export const DEFAULT_WATCH_MINUTES = 15;
export const MAX_WATCH_MINUTES = 120;

export const parameters = Type.Object(
    {
        action: stringEnum(ACTIONS, { description: "plan, run, status, rollback or watch" }),
        service: Type.String({
            description: "A service from the ops catalog. An unknown name is refused with the names there are",
        }),
        environment: Type.Optional(
            Type.String({
                description:
                    "One of the service's environments, such as staging. status without it reads every environment that has a pin",
            }),
        ),
        version: Type.Optional(
            Type.String({
                description: "plan, run, watch: the image tag to deploy or to wait for, such as 1.4.3",
            }),
        ),
        ticket: Type.Optional(
            Type.String({
                maxLength: 100,
                description: "plan, run: the ticket a pin is made for, where the environment's pin uses one",
            }),
        ),
        values: Type.Optional(
            Type.Object(
                {},
                {
                    additionalProperties: Type.String(),
                    description: "plan, run: values of a pin's line that the catalog lets a call set, name to value",
                },
            ),
        ),
        timeoutMinutes: Type.Optional(
            Type.Integer({
                minimum: 1,
                maximum: MAX_WATCH_MINUTES,
                description: `watch: minutes to watch, at most ${MAX_WATCH_MINUTES} (default ${DEFAULT_WATCH_MINUTES})`,
            }),
        ),
    },
    { additionalProperties: false },
);

/**
 * A call about an environment whose version is a pin (see pin-config.ts). `plan` and `status` read it. `run` and
 * `rollback` are carried only so that the tool can refuse them with the reason.
 */
export type PinCall =
    | {
          pin: true;
          action: "plan" | "run";
          env: Environment;
          source: PinSource;
          /** The `pin` deploy of the environment, when it has one. A read-only `pinned` has none. */
          deploy: PinDeploy | undefined;
          version: string;
          ticket: string | undefined;
          values: Readonly<Record<string, string>>;
      }
    | { pin: true; action: "status"; service: string; environments: readonly Environment[] }
    | { pin: true; action: "rollback"; env: Environment };

/** The `plan` or `run` of a pin. */
export type PinPlanCall = Extract<PinCall, { action: "plan" | "run" }>;

/** One call, checked: what the tool will do, in a typed form. */
export type Call =
    | { action: "plan"; env: Environment; target: Target; version: string }
    | { action: "run"; env: Environment; target: Target; version: string }
    | { action: "status"; env: Environment; target: Target }
    | { action: "rollback"; env: Environment; target: Target }
    | { action: "watch"; env: Environment; target: Target; version: string; timeoutMinutes: number };

/** The parameters each action takes besides `service` and `environment`. A parameter of another action is refused, so a
 *  call cannot ask for something the action would ignore. */
const TAKES: Readonly<Record<Action, { required: readonly string[]; optional: readonly string[] }>> = {
    plan: { required: ["version"], optional: ["ticket", "values"] },
    run: { required: ["version"], optional: ["ticket", "values"] },
    status: { required: [], optional: [] },
    rollback: { required: [], optional: [] },
    watch: { required: ["version"], optional: ["timeoutMinutes"] },
};

const USAGE = "Usage: deploy {action, service, environment, ...} with action plan, run, status, rollback or watch";

/** The parameters of an action that name an environment: all but a `status` of a whole service. */
const NEEDS_ENVIRONMENT = (action: Action): readonly string[] => (action === "status" ? [] : ["environment"]);

/** Ends every error about the shape of a call, so the model can correct it at once. */
export function usage(action: Action): string {
    const { required, optional } = TAKES[action];
    const names = [
        "service",
        action === "status" ? "environment?" : "environment",
        ...required,
        ...optional.map((name) => `${name}?`),
    ];
    return `Usage: deploy ${action} {${names.join(", ")}}`;
}

/**
 * An image tag, by the grammar of the registries: 1 to 128 letters, digits, `_`, `.` and `-`, not starting with `.` or
 * `-`. This is stricter than what `runtime rollout` accepts to wait for, because this is written into a cluster: it is
 * never something kubectl or helm could read as a flag, and never a digest or a second image.
 */
export const VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function present(value: unknown): boolean {
    return value !== undefined && value !== null;
}

function fail(action: Action, message: string): never {
    throw new InputError(`deploy ${action}: ${message}`);
}

function checkAction(value: unknown): Action {
    if (!present(value)) throw new InputError(`deploy needs action: ${ACTIONS.join(", ")}. ${USAGE}`);
    if (typeof value === "string" && (ACTIONS as readonly string[]).includes(value)) return value as Action;
    throw new InputError(`deploy: action must be one of ${ACTIONS.join(", ")} (got ${shown(value)}). ${USAGE}`);
}

function checkVersion(action: Action, value: unknown): string {
    if (typeof value === "string" && VERSION.test(value)) return value;
    return fail(
        action,
        "version must be an image tag of 1 to 128 characters (letters, digits, . _ -, not starting with . or -) " +
            `(got ${shown(value)})`,
    );
}

function checkMinutes(action: Action, value: unknown): number {
    if (!present(value)) return DEFAULT_WATCH_MINUTES;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_WATCH_MINUTES) {
        fail(action, `timeoutMinutes must be a whole number from 1 to ${MAX_WATCH_MINUTES} (got ${shown(value)})`);
    }
    return value;
}

/**
 * The Kubernetes runtime is where a rollout is read. An environment without one has nothing to plan, watch or run in.
 */
function kubernetesOf(action: Action, env: Environment): Target {
    if (env.kubernetes === undefined) {
        fail(
            action,
            `${env.service} in ${env.name} has no Kubernetes runtime in the catalog, so there is no rollout to read`,
        );
    }
    return env.kubernetes;
}

/** A version for a pin: the pin's own pattern when it has one, else an image tag. */
function checkPinVersion(action: Action, source: PinSource, value: unknown): string {
    if (source.version === undefined) return checkVersion(action, value);
    if (typeof value === "string" && matchesWhole(source.version, value)) return value;
    return fail(action, `version must match the pin's pattern ${source.version.source} (got ${shown(value)})`);
}

/** The ticket and the values of a pin call, each checked against the patterns the catalog gave the pin. */
function checkPinInputs(
    action: Action,
    env: Environment,
    deploy: PinDeploy | undefined,
    input: Readonly<Record<string, unknown>>,
): { ticket: string | undefined; values: Readonly<Record<string, string>> } {
    const ticket = present(input.ticket) ? input.ticket : undefined;
    const given = present(input.values) ? input.values : undefined;
    if (deploy === undefined) {
        if (ticket !== undefined || given !== undefined) {
            fail(action, `${env.service} in ${env.name} has no deploy, so it takes no ticket or values`);
        }
        return { ticket: undefined, values: {} };
    }
    if (ticket === undefined && usesTicket(deploy)) {
        fail(
            action,
            `${env.service} in ${env.name} needs ticket, which matches ${deploy.ticket?.source ?? "its pattern"}`,
        );
    }
    if (ticket !== undefined) {
        if (deploy.ticket === undefined) fail(action, `the pin of ${env.service} in ${env.name} takes no ticket`);
        if (typeof ticket !== "string" || !matchesWhole(deploy.ticket, ticket)) {
            fail(action, `ticket must match ${deploy.ticket.source} (got ${shown(ticket)})`);
        }
    }
    const values: Record<string, string> = {};
    if (given !== undefined) {
        if (!isObject(given)) fail(action, "values must be an object of text values");
        for (const [name, value] of Object.entries(given)) {
            const pattern = deploy.values.get(name);
            if (pattern === undefined) {
                const known =
                    deploy.values.size === 0 ? "it takes none" : `it takes ${shortList([...deploy.values.keys()])}`;
                fail(
                    action,
                    `${shown(name, 30)} is not a value the pin of ${env.service} in ${env.name} lets a call set; ${known}`,
                );
            }
            if (typeof value !== "string" || !matchesWhole(pattern, value)) {
                fail(action, `the value ${name} must match ${pattern.source} (got ${shown(value)})`);
            }
            values[name] = value;
        }
    }
    return { ticket: ticket as string | undefined, values };
}

/** The call about a pin, or undefined when the environment has none (and the call is about a cluster). */
function parsePin(action: Action, env: Environment, input: Readonly<Record<string, unknown>>): PinCall | undefined {
    const source = pinOf(env);
    if (source === undefined || action === "watch") return undefined;
    const deploy = env.deploy?.method === "pin" ? env.deploy : undefined;
    switch (action) {
        case "plan":
        case "run": {
            const version = checkPinVersion(action, source, input.version);
            return { pin: true, action, env, source, deploy, version, ...checkPinInputs(action, env, deploy, input) };
        }
        case "status":
            return { pin: true, action, service: env.service, environments: [env] };
        case "rollback":
            return { pin: true, action, env };
    }
}

/** `deploy status {service}`: every environment of the service that has a pin. */
function parseStatusOfService(catalog: Catalog, service: unknown): PinCall {
    const found = findService(catalog, "deploy", service);
    const environments = [...found.environments.values()].filter((env) => pinOf(env) !== undefined);
    if (environments.length === 0) {
        throw new InputError(
            `deploy status without environment reads the pins of a service, and ${found.name} has none. ` +
                `Name an environment: ${shortList([...found.environments.keys()])}. ${usage("status")}`,
        );
    }
    return { pin: true, action: "status", service: found.name, environments };
}

/**
 * Checks a call and returns it in a typed form. Every problem is an InputError, a `TypeError` that says what to change,
 * with the usage line when the shape is wrong, so the model can correct the call at once.
 */
export function parseCall(input: Readonly<Record<string, unknown>>, catalog: Catalog | undefined): Call | PinCall {
    if (catalog === undefined) throw notSetUp();
    const action = checkAction(input.action);
    const { required, optional } = TAKES[action];

    const known = new Set(["action", "service", "environment", ...required, ...optional]);
    const extra = Object.keys(input).filter((name) => present(input[name]) && !known.has(name));
    if (extra.length > 0) throw new InputError(`deploy ${action} does not use ${extra.join(", ")}. ${usage(action)}`);
    const missing = ["service", ...NEEDS_ENVIRONMENT(action), ...required].filter((name) => !present(input[name]));
    if (missing.length > 0) {
        const services = missing.includes("service") ? ` Known services: ${describeServices(catalog)}.` : "";
        throw new InputError(`deploy ${action} needs ${missing.join(", ")}.${services} ${usage(action)}`);
    }

    if (action === "status" && !present(input.environment)) return parseStatusOfService(catalog, input.service);
    const env = findEnvironment(catalog, "deploy", input.service, input.environment);
    const pinCall = parsePin(action, env, input);
    if (pinCall !== undefined) return pinCall;
    if (present(input.ticket) || present(input.values)) {
        const used = ["ticket", "values"].filter((name) => present(input[name]));
        throw new InputError(
            `deploy ${action} does not use ${used.join(", ")} here: ${env.service} in ${env.name} has no pin. ${usage(action)}`,
        );
    }
    const target = kubernetesOf(action, env);
    switch (action) {
        case "plan":
            return { action, env, target, version: checkVersion(action, input.version) };
        case "run":
            return { action, env, target, version: checkVersion(action, input.version) };
        case "status":
            return { action, env, target };
        case "rollback":
            return { action, env, target };
        case "watch": {
            const version = checkVersion(action, input.version);
            return { action, env, target, version, timeoutMinutes: checkMinutes(action, input.timeoutMinutes) };
        }
    }
}

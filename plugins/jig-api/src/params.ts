// The parameters of the `api` tool. One flat object, because several model providers reject a top-level union. ACTIONS says
// which parameters each action takes; the schema's action list, the usage lines in errors and the checks in parseCall all
// come from it, so they cannot drift apart.
import { stringEnum } from "../../jig-core/src/kit/schema.ts";
import { Type } from "typebox";
import { MAX_TIMEOUT_SEC } from "./config.ts";
import { METHODS } from "./engine/plan.ts";
import { InputError, isObject, shown } from "./engine/values.ts";

export type Param =
    | "collection"
    | "folder"
    | "request"
    | "text"
    | "environment"
    | "variables"
    | "method"
    | "url"
    | "body"
    | "headers"
    | "timeoutSec"
    | "workspace";

interface ActionSpec {
    required: readonly Param[];
    optional: readonly Param[];
}

export const ACTIONS = {
    list: { required: [], optional: ["collection", "folder", "text"] },
    show: { required: ["request"], optional: ["collection", "folder", "environment"] },
    run: { required: ["request", "environment"], optional: ["collection", "folder", "variables", "timeoutSec"] },
    run_folder: { required: ["folder", "environment"], optional: ["collection", "variables", "timeoutSec"] },
    call: { required: ["environment", "method", "url"], optional: ["collection", "body", "headers", "timeoutSec"] },
    postman_environments: { required: [], optional: ["collection", "workspace", "timeoutSec"] },
} as const satisfies Record<string, ActionSpec>;

export type ActionName = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

export function isAction(value: unknown): value is ActionName {
    return typeof value === "string" && Object.hasOwn(ACTIONS, value);
}

/** `Usage: api run {request, environment, collection?, ...}`; a parameter with `?` is optional. */
export function usage(action: ActionName): string {
    const { required, optional }: ActionSpec = ACTIONS[action];
    return `Usage: api ${action} {${[...required, ...optional.map((name) => `${name}?`)].join(", ")}}`;
}

/** The actions with the parameters each needs, for the schema: `list() show(request) ...`. */
function describeActions(): string {
    return ACTION_NAMES.join(", ");
}

export const parameters = Type.Object({
    action: stringEnum(ACTION_NAMES, { description: `What to do. Needs: ${describeActions()}` }),
    collection: Type.Optional(Type.String({ description: "Collection name." })),
    folder: Type.Optional(Type.String({ description: "Folder path, e.g. Orders/Smoke." })),
    request: Type.Optional(Type.String({ description: "Request name from list." })),
    text: Type.Optional(Type.String({ description: "list: text in name, folder or address." })),
    environment: Type.Optional(Type.String({ description: "Environment name, e.g. Staging." })),
    variables: Type.Optional(
        Type.Object(
            {},
            {
                additionalProperties: Type.String(),
                description: 'Variables, e.g. {"orderId": "123"}; never secrets or host',
            },
        ),
    ),
    method: Type.Optional(stringEnum(METHODS, { description: "call: GET/HEAD/OPTIONS read; others write." })),
    url: Type.Optional(Type.String({ description: "call: full address on an environment host." })),
    body: Type.Optional(Type.Unknown({ description: "call: JSON body, max 256 KiB; not GET." })),
    headers: Type.Optional(
        Type.Object(
            {},
            {
                additionalProperties: Type.String(),
                description: "call: extra headers, max 10; sign-in is added",
            },
        ),
    ),
    workspace: Type.Optional(
        Type.String({
            description:
                "postman_environments: a Postman workspace id, to list only its environments. Default: all the key can see",
        }),
    ),
    timeoutSec: Type.Optional(
        Type.Integer({
            minimum: 1,
            maximum: MAX_TIMEOUT_SEC,
            description: "Seconds to wait for the answer (default 30)",
        }),
    ),
});

export type Call =
    | { action: "list"; collection?: string; folder?: string; text?: string }
    | { action: "show"; request: string; collection?: string; folder?: string; environment?: string }
    | {
          action: "run";
          request: string;
          environment: string;
          collection?: string;
          folder?: string;
          variables?: Record<string, unknown>;
          timeoutSec?: number;
      }
    | {
          action: "run_folder";
          folder: string;
          environment: string;
          collection?: string;
          variables?: Record<string, unknown>;
          timeoutSec?: number;
      }
    | {
          action: "call";
          environment: string;
          method: string;
          url: string;
          collection?: string;
          body?: unknown;
          headers?: unknown;
          timeoutSec?: unknown;
      }
    | { action: "postman_environments"; collection?: string; workspace?: string; timeoutSec?: number };

const TEXT_PARAMS: readonly Param[] = [
    "collection",
    "folder",
    "request",
    "text",
    "environment",
    "method",
    "url",
    "workspace",
];

const present = (value: unknown): boolean => value !== undefined && value !== null;

/**
 * Checks the shape of a call and returns it typed. Every problem is an InputError, a `TypeError` that says what to change,
 * with the usage line when the shape is wrong, so the model can correct the call at once. What a name refers to is checked
 * later, where the names are known.
 */
export function parseCall(input: Readonly<Record<string, unknown>>): Call {
    const action = input.action;
    if (!isAction(action)) {
        throw new InputError(`api: unknown action ${shown(action, 30)}; use one of ${ACTION_NAMES.join(", ")}`);
    }
    const spec: ActionSpec = ACTIONS[action];
    const accepted = new Set<string>(["action", ...spec.required, ...spec.optional]);
    const extra = Object.keys(input).filter((name) => present(input[name]) && !accepted.has(name));
    if (extra.length > 0) throw new InputError(`api ${action} does not use ${extra.join(", ")}. ${usage(action)}`);
    const missing = spec.required.filter((name) => !present(input[name]));
    if (missing.length > 0) throw new InputError(`api ${action} needs ${missing.join(", ")}. ${usage(action)}`);

    for (const name of TEXT_PARAMS) {
        if (present(input[name]) && typeof input[name] !== "string") {
            throw new InputError(`api ${action}: ${name} must be text (got ${shown(input[name], 30)})`);
        }
    }
    if (present(input.variables) && !isObject(input.variables)) {
        throw new InputError(`api ${action}: variables must be an object of name to value, such as {"orderId": "123"}`);
    }
    const copy: Record<string, unknown> = { action };
    for (const name of accepted) if (name !== "action" && present(input[name])) copy[name] = input[name];
    return copy as Call;
}

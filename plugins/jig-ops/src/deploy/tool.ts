// The `deploy` tool: what Pi registers, and the classification and preview that make up jig-core's declaration of it.
//
//   plan, status   read, in the environment of the call. A status of a whole service reads every environment that has a
//                  pin, and is classified in the most restricted of them, so that production is masked as a whole
//   run, rollback  write in the environment of the call. jig-core asks the user, with the preview as the screen,
//                  and its floor denies production anyway
//   watch          a local write: it starts a watch on this machine, and changes no environment
//
// What may not run is refused in classify with a TypeError, so jig-core blocks the call without asking: an unknown
// service or environment, an environment the catalog gives no deploy method, production, and a rollback outside a
// test environment. The kind of an environment is asked of jig-core, which knows every name; a name it does not
// know counts as production.
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { jig } from "../../../jig-core/src/client.ts";
import type { CallClass, EnvironmentKind, Preview } from "../../../jig-core/src/contract.ts";
import { catalogOf } from "../catalog.ts";
import type { Kube } from "../runtime/kubernetes/kubectl.ts";
import { classifying, InputError, previewing } from "../values.ts";
import type { Outcome } from "../values.ts";
import { planAction, rollbackAction, runAction, statusAction, watchAction } from "./actions.ts";
import type { Context } from "./actions.ts";
import { parameters, parseCall } from "./params.ts";
import type { Call, PinCall } from "./params.ts";
import { planPinAction } from "./pin-plan.ts";
import { statusPinAction } from "./pin-status.ts";
import { planRollback, planRun, refusal } from "./plan.ts";
import { createRecords } from "./records.ts";

const DESCRIPTION =
    "Deploy a version of a service with the method the ops catalog names: plan what would change, run it " +
    "(the user is asked first), status, rollback (test environments only), and watch the rollout in the background. " +
    "Never production.";

type Input = Readonly<Record<string, unknown>>;

/** The parts of the tool a test replaces. */
export interface DeployOptions {
    /** The clock. Default: the real one. */
    now?: () => number;
    /**
     * How long a command that changes the cluster may run before it is stopped. Default: helm six minutes, kubectl one.
     */
    writeTimeoutMs?: number;
}

export interface DeployTool {
    definition: ToolDefinition<typeof parameters>;
    classify(input: Input): CallClass;
    preview(input: Input, signal: AbortSignal): Promise<Preview>;
}

/** The preview of a call about a pin. Only reads reach it: a run or a rollback of a pin is refused first. */
function pinPreview(call: PinCall): Preview {
    if (call.action === "status") return { summary: `show what ${call.service} is pinned to` };
    if (call.action === "plan")
        return { summary: `plan the pin of ${call.version} for ${call.env.service} in ${call.env.name}` };
    return { summary: `deploy ${call.action}` };
}

/** The catalog as jig-core loaded it. Read on every call, so a configuration change applies. */
function currentCatalog() {
    return catalogOf(jig().config.section("ops"));
}

/** What a run or a rollback of a pin is told until the pin writes (see docs/deploy.md). */
const PIN_RUN =
    "deploy run for the pin method is not available yet. deploy plan shows what it would change, and the change is a pull request a person can make";
const PIN_ROLLBACK = "a pin goes back by pinning the previous version: deploy run with that version";

/** Throws an InputError for a deploy or a rollback that may not run. */
function refuse(call: Call | PinCall): void {
    if (call.action !== "run" && call.action !== "rollback") return;
    const why = refusal(call.action, call.env, jig().environments.kindOf(call.env.name));
    if (why !== undefined) throw new InputError(`deploy ${call.action} is refused: ${why}`);
    if ("pin" in call) {
        throw new InputError(`deploy ${call.action} is refused: ${call.action === "run" ? PIN_RUN : PIN_ROLLBACK}`);
    }
}

/** Least to most restricted: what jig-core does with a read grows stricter down the list. */
const RESTRICTION: readonly EnvironmentKind[] = ["local", "test", "external", "production"];

/** The environment a call is classified in. A status of several environments takes the most restricted of them. */
function classifiedIn(call: Call | PinCall): string {
    if (!("environments" in call)) return call.env.name;
    const kindOf = (name: string): number => RESTRICTION.indexOf(jig().environments.kindOf(name));
    return call.environments.reduce((most, env) => (kindOf(env.name) > kindOf(most.name) ? env : most)).name;
}

export function createDeployTool(options: DeployOptions = {}): DeployTool {
    const ctx: Context = {
        now: options.now ?? Date.now,
        writeTimeoutMs: options.writeTimeoutMs,
        records: createRecords(),
    };

    function run(
        call: Call | PinCall,
        toolCallId: string,
        signal: AbortSignal | undefined,
    ): Promise<Outcome> | Outcome {
        if ("pin" in call) {
            switch (call.action) {
                case "status":
                    return statusPinAction(call, { signal });
                case "plan":
                    return planPinAction(call, jig().environments.kindOf(call.env.name), { signal });
                default:
                    throw new InputError(`deploy ${call.action} is refused: ${PIN_RUN}`);
            }
        }
        const kube: Kube = { target: call.target, signal };
        switch (call.action) {
            case "plan":
                return planAction(call, kube);
            case "run":
                return runAction(call, kube, toolCallId, ctx);
            case "status":
                return statusAction(call, kube, ctx);
            case "rollback":
                return rollbackAction(call, kube, toolCallId, ctx);
            case "watch":
                return watchAction(call, ctx);
        }
    }

    return {
        /**
         * Reads the catalog, on purpose. The decision needs it: the environment's kind is what refuses a production deploy
         * before anyone is asked, and the catalog is what says whether an environment has a deploy method at all. A later
         * "make classify pure" refactor must not remove this read — see docs/catalog.md, "Why a call reads the catalog".
         */
        classify(input) {
            return classifying(() => {
                const call = parseCall(input, currentCatalog());
                refuse(call);
                // A watch lives on this machine and reads the cluster; it changes no environment.
                if (call.action === "watch") return { action: call.action, environment: "local", effect: "write" };
                const effect = call.action === "run" || call.action === "rollback" ? "write" : "read";
                return { action: call.action, environment: classifiedIn(call), effect };
            });
        },

        // The review screen of a deploy or a rollback: the exact command, and the versions it goes between. The plan
        // reads the cluster, and the tool plans again when it runs and refuses if the plan is no longer this one.
        async preview(input, signal) {
            return previewing(async () => {
                const call = parseCall(input, currentCatalog());
                refuse(call);
                if ("pin" in call) return pinPreview(call);
                const kube: Kube = { target: call.target, signal };
                const kind = jig().environments.kindOf(call.env.name);
                const where = `${call.env.service} in ${call.env.name}`;
                switch (call.action) {
                    case "run":
                        return (await planRun(call.env, call.version, kube, kind)).preview;
                    case "rollback":
                        return (await planRollback(call.env, kube, kind)).preview;
                    case "plan":
                        return { summary: `plan the deploy of ${call.version} to ${where}` };
                    case "status":
                        return { summary: `show the last deploy and the rollout of ${where}` };
                    case "watch":
                        return { summary: `watch the rollout of ${where} to ${call.version}, in the background` };
                }
            });
        },

        definition: {
            name: "deploy",
            label: "Deploy",
            description: DESCRIPTION,
            promptSnippet:
                "deploy: plan, run (asks the user), status, rollback and watch a service's rollout; never production",
            promptGuidelines: [
                "deploy: plan first, then run; run asks the user. Then watch with the same version instead of polling.",
                "deploy: when run says the outcome is unknown, do not run it again. " +
                    "Check with status and tell the user.",
            ],
            parameters,
            // One call at a time and in order: a deploy must be done before the watch that follows it.
            executionMode: "sequential",
            async execute(toolCallId, params, signal) {
                const call = parseCall(params as Input, currentCatalog());
                // jig-core has classified the call already; checking again holds when the tool is run without it.
                refuse(call);
                const outcome = await run(call, toolCallId, signal);
                jig().addFacts(toolCallId, outcome.facts);
                return { content: [{ type: "text", text: outcome.text }], details: outcome.details };
            },
        },
    };
}

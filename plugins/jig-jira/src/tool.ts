// The `jira` tool: what Pi registers, and the two functions jig-core's declaration is made of besides its name (classify
// and preview). `execute` and `preview` both check the call the same way and build the same plan, so what the person
// approved is what is sent.
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { jig } from "../../jig-core/src/client.ts";
import type { CallClass, Preview } from "../../jig-core/src/contract.ts";
import type { Env, Session } from "./api.ts";
import { classifyCall } from "./classify.ts";
import { settingsOf } from "./config.ts";
import { createHttp } from "./http.ts";
import type { Timeouts } from "./http.ts";
import { ACTIONS, parameters, parseCall } from "./params.ts";
import type { Call, ParseOptions } from "./params.ts";
import { fingerprintOf } from "./plan.ts";
import { buildPlan } from "./plans.ts";
import { runRead } from "./reads.ts";
import { transportFacts } from "./http.ts";
import { previewOf } from "./shown.ts";
import { InputError } from "./values.ts";
import { runWrite } from "./writes.ts";

export interface JiraOptions {
    timeouts?: Timeouts;
}

// At most 200 characters (registration.test.ts). The skill carries the rest: reading before writing, and what a search by
// who commented returns.
const DESCRIPTION =
    "Read and change Jira issues in wiki markup. Writes preview and ask; read before changing. Read the jira skill " +
    "before you change an issue.";

function describeCall(call: Call): string {
    const target = "key" in call ? ` ${call.key}` : "";
    return `jira ${call.action}${target}`;
}

export interface JiraTool {
    definition: ToolDefinition<typeof parameters>;
    classify(input: Readonly<Record<string, unknown>>): CallClass | undefined;
    preview(input: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Preview>;
    /** The same line the preview gives a read, for Pi's timeline. Undefined when the input is not a valid call. */
    summary(input: Readonly<Record<string, unknown>>): string | undefined;
}

export function createTool(options: JiraOptions = {}): JiraTool {
    // What one Pi session has learned about this Jira: which search endpoint it has, and its field list.
    const session: Session = {};

    function envFor(signal: AbortSignal | undefined): Env {
        const settings = settingsOf(jig().config.section("jira"));
        if (settings === undefined) {
            // An InputError, so that jig-core blocks the call without asking: nothing can work until this is fixed.
            throw new InputError(
                'jira is not set up: add a "jira" section with "site" and "auth" to jig.json ' +
                    "(/jig lists configuration problems)",
            );
        }
        const http = createHttp(settings, { ...options, ...(signal === undefined ? {} : { signal }) });
        return { settings, session, http, ...(signal === undefined ? {} : { signal }) };
    }

    /** How a call is read: with the user's project keys, so that a search may leave the JQL out. */
    function parsing(): ParseOptions {
        return { projects: settingsOf(jig().config.section("jira"))?.projects ?? [] };
    }

    return {
        classify: (input) => classifyCall(input, settingsOf(jig().config.section("jira"))),

        summary(input) {
            try {
                return describeCall(parseCall(input, parsing()));
            } catch {
                return undefined;
            }
        },

        async preview(input, signal) {
            try {
                const call = parseCall(input, parsing());
                if (ACTIONS[call.action].kind === "read") return { summary: describeCall(call) };
                const plan = await buildPlan(envFor(signal), call, true);
                return { ...previewOf(plan.shown), fingerprint: fingerprintOf(plan) };
            } catch (error) {
                // jig-core takes any TypeError from a preview to mean that the input is invalid, and blocks the call
                // without asking. Only an InputError may say so: a TypeError from a bug here is an ordinary failure,
                // which shows as "preview unavailable" and leaves the decision to the person.
                if (error instanceof TypeError && !(error instanceof InputError)) {
                    throw new Error(`internal error: ${error.message}`);
                }
                throw error;
            }
        },

        definition: {
            name: "jira",
            label: "Jira",
            description: DESCRIPTION,
            promptSnippet: "read, search and change Jira issues: comments, transitions, fields, new issues",
            parameters,
            // One call at a time and in order: a comment must be on the issue before the transition that follows it.
            executionMode: "sequential",
            async execute(toolCallId, params, signal) {
                const call = parseCall(params, parsing());
                const env = envFor(signal);
                try {
                    if (ACTIONS[call.action].kind === "read") {
                        const text = await runRead(env, call, toolCallId);
                        return { content: [{ type: "text", text }], details: { action: call.action } };
                    }
                    const written = await runWrite(env, call, toolCallId, signal);
                    const key = written.key === undefined ? {} : { key: written.key };
                    return {
                        content: [{ type: "text", text: written.text }],
                        details: { action: call.action, ...key },
                    };
                } catch (error) {
                    const facts = transportFacts(error);
                    if (Object.keys(facts).length > 0) jig().addFacts(toolCallId, facts);
                    throw error;
                }
            },
        },
    };
}

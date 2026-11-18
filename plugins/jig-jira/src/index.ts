// Pi entry point of jig-jira. The factory only registers: the `jira` section and the tool's declaration go to jig-core,
// and the tool to Pi. Nothing is read or sent until a call is made.
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { validateJira } from "./config.ts";
import { JIRA_SETUP } from "./onboarding.ts";
import { createTool } from "./tool.ts";
import type { JiraOptions } from "./tool.ts";

export type { JiraOptions };

/** A Jira token: a secret reference the person builds from a store, with the shapes and the add commands setup shows. */
function JIRA_TOKEN(label: string) {
    return {
        kind: "reference" as const,
        path: "auth.token",
        label,
        why: "Jig reads the token from there when a tool needs it; it never sees the value here.",
        stores: ["pass", "op", "keychain", "env", "file"] as const,
        suggested: {
            pass: "pass:work/jira-pat",
            env: "env:JIRA_API_TOKEN",
            op: "op://Work/jira/pat",
        },
        addHints: {
            pass: "pass insert work/jira-pat",
            env: "export JIRA_API_TOKEN=… where Pi starts",
            op: "Save the token as the pat field of a Jira item in a vault.",
        },
    };
}

/** The extension, with parts a test can replace (the timeouts). Pi loads the default export below. */
export const JIRA_METHODS = [
    {
        id: "cloud-basic",
        label: "Email and API token",
        who: "Jira Cloud",
        fields: [
            {
                kind: "text",
                path: "auth.email",
                label: "Your Jira email",
                why: "Jira Cloud signs each request with it.",
            },
            JIRA_TOKEN("The Jira API token"),
        ],
    },
    {
        id: "data-center-pat",
        label: "Personal access token",
        who: "Jira Data Center",
        fields: [JIRA_TOKEN("The Jira personal access token")],
    },
    {
        id: "oauth",
        label: "Token command (your OAuth helper prints a short-lived token)",
        who: "Jira Cloud or Data Center",
        fields: [
            {
                kind: "reference",
                path: "auth.oauth",
                label: "The OAuth token command",
                why: "A command you trust prints a short-lived token; Jig stores only the command.",
            },
            {
                kind: "text",
                path: "auth.cloudId",
                label: "The Cloud site id",
                optional: true,
                why: "Only Jira Cloud needs it; the token then goes to api.atlassian.com.",
            },
        ],
    },
    {
        id: "sign-in-service",
        label: "Company sign-in service",
        companyOnly: true,
        fields: [{ kind: "text", path: "auth.signIn", label: "The sign-in service name" }],
    },
    {
        id: "transport",
        label: "Through a session relay or transport",
        who: "it holds your session, so Jig holds no Jira token",
        viaTransport: true,
        fields: [
            {
                kind: "text",
                path: "auth.transport",
                label: "Relay or transport for Jira requests",
                why: "Jig sends each request to it by name, and it signs in; no Jira token is kept.",
            },
            {
                kind: "number",
                path: "timeoutSeconds",
                label: "Jira request time limit (seconds)",
                optional: true,
                default: 30,
                question: "How long may most Jira requests take, in seconds?",
                why: "A request that takes longer is stopped (5 to 120 seconds); a browser relay may need up to 120 right after you sign in. A search has its own limit, searchTimeoutSeconds in your settings (60 seconds unless you set it), which this does not change.",
            },
        ],
    },
] as const;

export function jigJira(options: JiraOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        const tool = createTool(options);
        withJig((api) => {
            // `auth` is one choice among four, so a teammate's replaces the company's whole. `privateNames` is a list
            // that protects against leaking an internal name: a teammate's adds to the company's and cannot drop them.
            api.config.registerSection("jira", validateJira, {
                replace: ["auth"],
                union: ["privateNames"],
                methods: JIRA_METHODS,
                setup: JIRA_SETUP,
            });

            api.declareTool({ tool: "jira", plugin: "jig-jira", classify: tool.classify, preview: tool.preview });
        });
        registerJigTool(pi, tool.definition, { summary: tool.summary });
    };
}

export default jigJira();

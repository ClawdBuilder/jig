// Pi entry point of jig-jira. The factory only registers: the `jira` section and the tool's declaration go to jig-core,
// and the tool to Pi. Nothing is read or sent until a call is made.
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { validateJira } from "./config.ts";
import { createTool } from "./tool.ts";
import type { JiraOptions } from "./tool.ts";

export type { JiraOptions };

/** The extension, with parts a test can replace (the timeouts). Pi loads the default export below. */
export function jigJira(options: JiraOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        const tool = createTool(options);
        withJig((api) => {
            // `auth` is one choice among four, so a teammate's replaces the company's whole. `privateNames` is a list
            // that protects against leaking an internal name: a teammate's adds to the company's and cannot drop them.
            api.config.registerSection("jira", validateJira, { replace: ["auth"], union: ["privateNames"] });
            api.onboarding?.registerMethods("jira", [
                {
                    id: "cloud-basic",
                    label: "Email and API token",
                    who: "Jira Cloud",
                    fields: [
                        { kind: "text", path: "auth.email", label: "Your Jira email" },
                        { kind: "reference", path: "auth.token", label: "The Jira API token" },
                    ],
                },
                {
                    id: "data-center-pat",
                    label: "Personal access token",
                    who: "Jira Data Center",
                    fields: [{ kind: "reference", path: "auth.token", label: "The Jira personal access token" }],
                },
                {
                    id: "oauth",
                    label: "Token command (your OAuth helper prints a short-lived token)",
                    who: "Jira Cloud or Data Center",
                    fields: [
                        { kind: "reference", path: "auth.oauth", label: "The OAuth token command" },
                        { kind: "text", path: "auth.cloudId", label: "The Cloud site id", optional: true },
                    ],
                },
                {
                    id: "sign-in-service",
                    label: "Company sign-in service",
                    fields: [{ kind: "text", path: "auth.signIn", label: "The sign-in service name" }],
                },
                {
                    id: "transport",
                    label: "Company transport",
                    fields: [{ kind: "text", path: "auth.transport", label: "The transport name" }],
                },
            ]);
            api.declareTool({ tool: "jira", plugin: "jig-jira", classify: tool.classify, preview: tool.preview });
        });
        registerJigTool(pi, tool.definition, { summary: tool.summary });
    };
}

export default jigJira();

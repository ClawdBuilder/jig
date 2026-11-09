// jig-logs: log search for the agent. One tool, `logs`, that reads the logs of an Elasticsearch, OpenSearch or Loki
// backend. The tool only says what each call does; jig-core decides whether it runs and masks what comes back.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { validateLogsSection } from "./config.ts";
import { createLogsTool } from "./tool.ts";

const tool = createLogsTool();

export const LOGS_METHODS = [
    {
        id: "basic",
        label: "User name and password",
        fields: [
            { kind: "text", path: "backend.auth.username", label: "The log user name" },
            { kind: "reference", path: "backend.auth.password", label: "The log password" },
        ],
    },
    {
        id: "api-key",
        label: "API key",
        fields: [{ kind: "reference", path: "backend.auth.apiKey", label: "The log API key" }],
    },
    {
        id: "token",
        label: "Service token",
        fields: [{ kind: "reference", path: "backend.auth.token", label: "The log service token" }],
    },
    {
        id: "sign-in-service",
        label: "Company sign-in service",
        fields: [{ kind: "text", path: "backend.auth.signIn", label: "The sign-in service name" }],
    },
    {
        id: "transport",
        label: "Company transport",
        fields: [{ kind: "text", path: "backend.transport", label: "The transport name" }],
    },
] as const;

export default function (pi: ExtensionAPI) {
    registerJigTool(pi, tool.definition);
    // jig-core may load after this plugin; withJig waits for it. What the tool declares is how jig-core classifies it.
    withJig((api) => {
        api.declareTool(tool.declaration);
        api.config.registerSection("logs", validateLogsSection, {
            replace: ["backend.auth"],
            oneOf: [["backend.auth", "backend.transport"]],
        });

        api.onboarding?.registerMethods("logs", LOGS_METHODS);
    });
}

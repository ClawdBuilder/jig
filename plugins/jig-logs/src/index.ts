// jig-logs: log search for the agent. One tool, `logs`, that reads the logs of an Elasticsearch, OpenSearch or Loki
// backend. The tool only says what each call does; jig-core decides whether it runs and masks what comes back.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { validateLogsSection } from "./config.ts";
import { LOGS_SETUP } from "./onboarding.ts";
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
        companyOnly: true,
        fields: [{ kind: "text", path: "backend.auth.signIn", label: "The sign-in service name" }],
    },
    {
        id: "transport",
        label: "Through a session relay or transport",
        who: "it holds your session, so Jig holds no log credential",
        viaTransport: true,
        fields: [
            {
                kind: "text",
                path: "backend.transport",
                label: "Relay or transport for log searches",
                why: "Jig sends each request to it by name, and it signs in; no log credential is kept.",
            },
        ],
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
            methods: LOGS_METHODS,
            setup: LOGS_SETUP,
        });
    });
}

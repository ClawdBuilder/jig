// Pi entry point of jig-api. The factory only registers: the `api` section and the tool's declaration go to jig-core, and the
// tool and the command `/api refresh` to Pi. Nothing is read or sent until a call is made.
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { API_REPLACE, validateApi } from "./config.ts";
import { registerRefresh } from "./refresh.ts";
import { createTool } from "./tool.ts";
import type { ApiOptions } from "./tool.ts";

export type { ApiOptions };

/** The extension, with parts a test can replace (the clock and the timeouts). Pi loads the default export below. */
export const API_METHODS = [
    {
        id: "environment-sign-in",
        label: "Company sign-in service for an environment",
        fields: [
            { kind: "text", path: "environments.*.environment", label: "The Jig environment name" },
            { kind: "text", path: "environments.*.signIn", label: "The sign-in service name" },
        ],
    },
    {
        id: "environment-transport",
        label: "Company transport for an environment",
        fields: [
            { kind: "text", path: "environments.*.environment", label: "The Jig environment name" },
            { kind: "text", path: "environments.*.transport", label: "The transport name" },
        ],
    },
] as const;

export function jigApi(options: ApiOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        const tool = createTool(options);
        withJig((api) => {
            api.config.registerSection("api", validateApi, { replace: API_REPLACE });

            api.onboarding?.registerMethods("api", API_METHODS);

            api.declareTool({ tool: "api", plugin: "jig-api", classify: tool.classify, preview: tool.preview });
        });
        registerJigTool(pi, tool.definition);
        registerRefresh(pi, options);
    };
}

export default jigApi();

// Pi entry point of jig-ops. The factory only registers: the `ops` section, the tools' declarations and the watch
// kinds go to jig-core, the tools go to Pi, and the listener for pushes goes to Pi's event bus. Nothing is read from
// a cluster or a CI server until a call is made.
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { OPS_REPLACE, validateOps } from "./catalog.ts";
import { createAutoWatch, listenForPushes } from "./ci/autowatch.ts";
import { createCiTool } from "./ci/tool.ts";
import { registerCiWatch } from "./ci/watch.ts";
import type { CiWatchOptions } from "./ci/watch.ts";
import { createDeployTool } from "./deploy/tool.ts";
import type { DeployOptions } from "./deploy/tool.ts";
import { createRuntimeTool } from "./runtime/tool.ts";
import type { RuntimeOptions } from "./runtime/tool.ts";
import { registerRolloutWatch } from "./watch.ts";

/** The parts of the plugin a test replaces: the clock, the sleep, the fetch and the timeouts. */
export type OpsOptions = RuntimeOptions & DeployOptions & CiWatchOptions;

/** The extension, with parts a test can replace. Pi loads the default export below. */
export function jigOps(options: OpsOptions = {}): ExtensionFactory {
    return (pi: ExtensionAPI) => {
        // "Artifact ready" is published on Pi's event bus, for any plugin that wants to act on it.
        const announce = (event: string, payload: unknown): void => pi.events.emit(event, payload);
        const runtime = createRuntimeTool(options);
        const deploy = createDeployTool(options);
        const ci = createCiTool({ ...options, announce });
        // jig-core may load after this plugin; withJig waits for it.
        // What the tools declare is how jig-core classifies them.
        withJig((api) => {
            api.config.registerSection("ops", validateOps, { replace: OPS_REPLACE });
            api.onboarding?.registerMethods("ops", [
                {
                    id: "ci-token",
                    label: "CI token",
                    who: "GitLab or Concourse",
                    fields: [{ kind: "reference", path: "services.*.ci.auth.token", label: "The CI token" }],
                },
                {
                    id: "ci-basic",
                    label: "User name and API token",
                    who: "Jenkins",
                    fields: [
                        { kind: "text", path: "services.*.ci.auth.user", label: "The CI user name" },
                        { kind: "reference", path: "services.*.ci.auth.token", label: "The CI API token" },
                    ],
                },
                {
                    id: "ci-sign-in",
                    label: "Company sign-in service",
                    fields: [{ kind: "text", path: "services.*.ci.auth.signIn", label: "The sign-in service name" }],
                },
                {
                    id: "ci-transport",
                    label: "Company transport",
                    fields: [{ kind: "text", path: "services.*.ci.auth.transport", label: "The transport name" }],
                },
            ]);
            api.declareTool({ tool: "runtime", plugin: "jig-ops", classify: runtime.classify });
            api.declareTool({ tool: "deploy", plugin: "jig-ops", classify: deploy.classify, preview: deploy.preview });
            api.declareTool({ tool: "ci", plugin: "jig-ops", classify: ci.classify, preview: ci.preview });
            registerRolloutWatch(api, options);
            registerCiWatch(api, announce, options);
        });
        registerJigTool(pi, runtime.definition);
        registerJigTool(pi, deploy.definition);
        registerJigTool(pi, ci.definition);
        listenForPushes(pi, createAutoWatch(options.now));
    };
}

export default jigOps();

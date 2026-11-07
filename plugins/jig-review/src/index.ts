// jig-review: a private, GitHub-style review of the agent's changes in the browser, before anything is shared. The factory
// only registers: nothing is written and no server starts until the user opens a review.
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import type { CallClass, JigApi, ToolDeclaration } from "../../jig-core/src/contract.ts";
import { ReviewCoordinator } from "./coordinator.ts";
import { reviewRoot, validateReviewSection } from "./settings.ts";
import { holdReason } from "./hold.ts";
import { RESOLUTION_TOOL, START_TOOL } from "./tools.ts";

/** Both tools only write this plugin's own review files, in a folder under Pi's agent folder. */
const LOCAL_WRITE: CallClass = { environment: "local", effect: "write" };

export const DECLARATIONS: ToolDeclaration[] = [START_TOOL, RESOLUTION_TOOL].map((tool) => ({
    tool,
    plugin: "jig-review",
    classify: () => LOCAL_WRITE,
}));

let gateInstances = 0;

/** The gate jig-core asks about every call: it reads the coordinator at call time, never a module variable. */
export function registerReviewGate(
    coordinator: Pick<ReviewCoordinator, "holdsAgent" | "noteHoldDenial">,
    api: { gates?: { register(gate: Parameters<NonNullable<JigApi["gates"]>["register"]>[0]): void } },
): void {
    api.gates?.register({
        name: `review-wait:${++gateInstances}`,
        plugin: "jig-review",
        check(call) {
            const reason = holdReason(call, coordinator.holdsAgent());
            if (reason !== undefined) coordinator.noteHoldDenial();
            return reason === undefined ? undefined : { decision: "deny", reason };
        },
    });
}

export default function (pi: ExtensionAPI) {
    const coordinator = new ReviewCoordinator(pi, process.cwd(), { root: reviewRoot(getAgentDir()) });
    coordinator.register();
    withJig((api) => {
        api.config.registerSection("review", validateReviewSection);
        registerReviewGate(coordinator, api);
    });
    // jig-core may load after this plugin; withJig waits for it.
    withJig((api) => {
        for (const declaration of DECLARATIONS) api.declareTool(declaration);
    });
}

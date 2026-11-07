// What the gate does with one call while an agent-started review waits for the person. Pure, so the cases are testable
// without a Pi.
import type { GateCall } from "../../jig-core/src/contract.ts";
import { RESOLUTION_TOOL, START_TOOL } from "./tools.ts";

export const WAIT_REASON =
    "a code review is open in the browser and waiting for the person. Stop and wait for their message; approval or comments " +
    "release this call.";

let active = false;
/** Set when an agent-opened review waits; cleared by approval, comments, a person's message or a restart. */
export const setReviewHold = (held: boolean): void => {
    active = held;
};
export const reviewHoldActive = (): boolean => active;

/** A refusal for a write while a review waits, or undefined to let it through. Reads and the resolution tool stay open. */
export function holdReason(call: Pick<GateCall, "tool" | "effect">, holding: boolean): string | undefined {
    if (!holding) return undefined;
    if (call.tool === START_TOOL || call.tool === RESOLUTION_TOOL) return undefined;
    if (call.effect === "read") return undefined;
    return WAIT_REASON;
}

// The "Deploys" line of a trigger preview. A CI job that deploys an environment deploys what the environment is pinned to
// (see the `pin` deploy method), so the person who is asked to start the job is told what that is, read from the control
// repository now. The pinned version is part of the fingerprint: if it moves between the preview and the send, nothing is sent.
import type { Preview } from "../../../jig-core/src/contract.ts";
import { pinOf } from "../catalog.ts";
import type { Environment } from "../catalog.ts";
import { readPin, ticketOf } from "../deploy/pin-read.ts";
import { digest } from "../values.ts";
import type { Plan } from "./adapter.ts";

/** What an environment is pinned to, as one phrase, and a short mark of it for the fingerprint. */
export interface PinnedLine {
    text: string;
    mark: string;
}

/** What the environment's branch pins, or undefined when the environment has no pin. A pin that cannot be read says so. */
export async function pinnedLine(env: Environment, signal: AbortSignal | undefined): Promise<PinnedLine | undefined> {
    const source = pinOf(env);
    const first = source?.pins[0];
    if (source === undefined || first === undefined) return undefined;
    try {
        const read = await readPin(source, first, { signal });
        const ticket = ticketOf(source, read);
        return {
            text: `what ${source.base} pins: ${read.version}${ticket === undefined ? "" : ` (${ticket})`}`,
            mark: `${read.version}|${ticket ?? ""}`,
        };
    } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        return { text: `what ${source.base} pins could not be read (${why})`, mark: "unreadable" };
    }
}

/** The rows at the head of a preview body (`Service:  orders-api`), which a short label starts. */
const ROW = /^[A-Z][A-Za-z ]{0,13}: +/;

/** The body with the "Deploys" row after the rows at its head, in the column the others use. */
function withRow(body: string, text: string): string {
    const lines = body.split("\n");
    let end = 0;
    while (end < lines.length && ROW.test(lines[end] as string)) end++;
    const column = end === 0 ? 15 : (ROW.exec(lines[end - 1] as string)?.[0].length ?? 15);
    lines.splice(end, 0, `${"Deploys:".padEnd(column)}${text}`);
    return lines.join("\n");
}

/** The plan with the pinned version shown, and part of what the approval is for. */
export function withPinnedLine(plan: Plan, pinned: PinnedLine): Plan {
    const { body, fingerprint } = plan.preview;
    const preview: Preview = {
        ...plan.preview,
        ...(body === undefined ? {} : { body: withRow(body, pinned.text) }),
        ...(fingerprint === undefined ? {} : { fingerprint: digest(fingerprint, "pin", pinned.mark) }),
    };
    return { ...plan, preview };
}

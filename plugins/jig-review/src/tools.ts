// The two tools the agent has for the review loop. Both only change this plugin's own files, so jig-core classifies them
// as local writes (see index.ts). Neither can approve: approving needs the user.
import { stringEnum } from "../../jig-core/src/kit/schema.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ReviewRecord, ReviewResolution } from "./types.ts";

type ToolResult = { content: { type: "text"; text: string }[]; details: object };

export interface ReviewToolHandlers {
    getCurrentReview: () => ReviewRecord | undefined;
    recordResolution: (resolution: Omit<ReviewResolution, "id" | "createdAt">) => Promise<ReviewRecord>;
    /** Opens the review `/code-review` would. Undefined only for the settings menu, which the tool never asks for. */
    startReview: (ctx: ExtensionContext) => Promise<{ url: string; person?: boolean } | { error: string } | undefined>;
}

export const START_TOOL = "start_interactive_code_review";
export const RESOLUTION_TOOL = "record_interactive_review_resolution";

/** What the start tool tells the agent. It never holds the page link: that goes to the user alone. */
export const OPENED_TEXT = "Code review open; waiting for you. Reopen with /code-review.";

export function registerReviewTools(pi: ExtensionAPI, handlers: ReviewToolHandlers): void {
    registerJigTool(pi, {
        name: START_TOOL,
        label: "Start Interactive Code Review",
        description:
            "Open the browser code review for the user: with an active ticket its bound repositories' branches since the main branch, otherwise the uncommitted changes. This satisfies workflow's review-done condition; the user approves in the browser.",
        parameters: Type.Object({}),
        execute: async (_toolCallId, _params, _signal, _onUpdate, ctx): Promise<ToolResult> => {
            const outcome = await handlers.startReview(ctx);
            // The link carries the server's session secret, so it goes only to the user (Pi's notice and the browser).
            const text =
                outcome === undefined || "error" in outcome
                    ? `The review did not open: ${outcome?.error ?? "unknown reason"}`
                    : outcome.person === true
                      ? "The person already has this review open; it is theirs and nothing is held. Send a message to continue."
                      : OPENED_TEXT;
            return { content: [{ type: "text", text }], details: {} };
        },
    });

    registerJigTool(pi, {
        name: RESOLUTION_TOOL,
        label: "Record Review Resolution",
        description:
            "Record how the agent addressed interactive review comments. Include addressedLocations for changed diff lines. If code changed, beforeAfter must be a small unified diff snippet, not a prose explanation.",
        parameters: Type.Object({
            commentIds: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 200 }),
            kind: stringEnum(["fixed", "answered", "wont-fix"] as const),
            summary: Type.String({ maxLength: 10_000 }),
            addressedLocations: Type.Optional(
                Type.Array(
                    Type.Object({
                        body: Type.Optional(Type.String({ maxLength: 5000 })),
                        filePath: Type.String({ maxLength: 1000 }),
                        line: Type.Number(),
                        side: Type.Optional(stringEnum(["old", "new"] as const)),
                    }),
                    { maxItems: 200 },
                ),
            ),
            beforeAfter: Type.Optional(
                Type.String({
                    maxLength: 20_000,
                    description:
                        "Small unified diff snippet for code changes. Do not use prose like 'Before:'/'After:' explanations.",
                }),
            ),
        }),
        execute: async (_toolCallId, params): Promise<ToolResult> => {
            if (handlers.getCurrentReview() === undefined) {
                return { content: [{ type: "text", text: "No active interactive review is open." }], details: {} };
            }
            const review = await handlers.recordResolution({
                commentIds: params.commentIds,
                kind: params.kind,
                summary: params.summary,
                addressedLocations: params.addressedLocations,
                beforeAfter: params.beforeAfter,
            });
            return {
                content: [{ type: "text", text: "Recorded interactive review resolution." }],
                details: { reviewId: review.id },
            };
        },
    });
}

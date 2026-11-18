// What setup asks for jig-core's own `transports` section: one session relay, a program that holds the person's session
// for Jira or logs. The section is jig-core's, so it is not registered like a plugin's; `setupStateFrom` adds it to the
// sections setup lists. This file also names the transports that exist, for a sign-in method that goes through one.
import type { SectionCheck } from "./config.ts";
import type { OnboardingSetup } from "./contract-onboarding.ts";
import { mergedSection } from "./setup-questions.ts";
import type { SetupState } from "./setup-plan.ts";
import { isObject } from "./setup-values.ts";
import { TRANSPORTS_SECTION, validateTransportsSection } from "./transports-section.ts";

/** The `transports` section's questions: one relay, asked as a name, its address and where its token is kept. */
export const TRANSPORTS_SETUP: OnboardingSetup = {
    summary: "A session relay: Jira and logs through a program that holds your session.",
    items: [
        {
            kind: "info",
            label: "A session relay",
            detail: "It is a program that keeps your sign-in, such as a browser extension's local host. Jig sends the request to it and holds no Jira token.",
        },
        {
            kind: "object",
            section: TRANSPORTS_SECTION,
            path: "",
            label: "Session relay",
            why: "Jira and logs name this relay in their settings to send requests through it.",
            keyLabel: "What do you call this relay?",
            keyPlaceholder: "orders-relay",
            optional: true,
            forms: [
                {
                    fixed: { kind: "relay" },
                    fields: [
                        {
                            kind: "text",
                            path: "url",
                            label: "The relay's address",
                            placeholder: "http://127.0.0.1:8700",
                            why: "Plain http is only for this machine (127.0.0.1, localhost or [::1]); any other address must be https.",
                        },
                        {
                            kind: "reference",
                            path: "token",
                            label: "The relay's token",
                            why: "It tells the relay the request is Jig's; it is not a Jira token. A relay usually writes it to a file, so choose a file and name it.",
                        },
                    ],
                },
            ],
        },
    ],
};

/** The sections setup lists and checks: the plugins' own, with `transports` first, so a relay can be set up before the
 *  tools that go through it. */
export function withTransports(
    checks: ReadonlyMap<string, SectionCheck>,
    setups: ReadonlyMap<string, OnboardingSetup>,
): { sectionChecks: Map<string, SectionCheck>; sectionSetup: Map<string, OnboardingSetup> } {
    return {
        sectionChecks: new Map([[TRANSPORTS_SECTION, validateTransportsSection], ...checks]),
        sectionSetup: new Map([[TRANSPORTS_SECTION, TRANSPORTS_SETUP], ...setups]),
    };
}

/** The names of the transports that exist now: the person's `transports` (answers of this run included) under a
 *  company's defaults, then the ones a company plugin registered in code. */
export function transportNames(state: SetupState, raw: Record<string, unknown>): string[] {
    const merged = mergedSection(state, TRANSPORTS_SECTION, raw);
    const configured = isObject(merged) ? Object.keys(merged) : [];
    return [...new Set([...configured, ...(state.pluginTransports ?? [])])];
}

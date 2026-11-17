// What a Jira needs from a person, in plain questions, when no company plugin fills it in. The sign-in forms are the
// methods `registerSection` declares (`JIRA_METHODS`); this list asks for where the Jira is and which projects to work in.
import type { OnboardingSetup } from "../../jig-core/src/contract.ts";

export const JIRA_SETUP: OnboardingSetup = {
    summary: "Read, search and comment on issues in your Jira.",
    items: [
        {
            kind: "info",
            label: "Your Jira",
            detail: "Jig reads the token from the store you choose; it never signs in for you.",
        },
        {
            kind: "text",
            section: "jira",
            path: "site",
            label: "Your Jira address",
            placeholder: "https://example.atlassian.net",
            why: "Every request goes to this https address.",
        },
        {
            kind: "text",
            section: "jira",
            path: "projects",
            label: "Project keys to work in",
            placeholder: "PROJ, OPS",
            list: true,
            optional: true,
            why: "Search without JQL and writes stay in these projects. Empty allows any project.",
        },
    ],
};

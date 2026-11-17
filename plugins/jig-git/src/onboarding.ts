// What a git needs from a person, in plain questions, when no company plugin fills it in: the gh login, and which gh
// account Jig uses for a set of repositories. Sign-in stays with gh; Jig never switches the active account and keeps no
// token, so the only credential question is where `gh` itself keeps one.
import type { OnboardingSetup } from "../../jig-core/src/contract.ts";

export const GIT_SETUP: OnboardingSetup = {
    summary: "Work with git, pull requests and releases.",
    items: [
        {
            kind: "login",
            tool: "gh",
            status: ["gh", "auth", "status"],
            login: "gh auth login",
            label: "GitHub login",
            why: "Pull requests, reviews and releases go through gh.",
        },
        {
            kind: "entry",
            section: "git",
            path: "accounts",
            label: "Which GitHub account should Jig use for a set of repositories?",
            keyLabel: "Which repositories?",
            keyPlaceholder: "github.com:acme/*",
            valueLabel: "Which gh account?",
            valuePlaceholder: "acme-work",
            // Optional: a person with one gh account, or none, leaves the map unset. The probe fills the value, not the
            // key, so an empty key still means "no mapping".
            optional: true,
            repeat: true,
            detect: "gh-account",
            why: "With more than one gh account, the first pattern that matches the remote picks the account; Jig never switches your active account.",
        },
    ],
};

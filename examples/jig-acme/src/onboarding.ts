// Acme's onboarding list: what a person must supply before Acme's tools work, in the company's order and words. `/jig setup`
// asks these in this order, and `/jig doctor` repeats the ones still missing; a person never types a reference or a token.
import type { OnboardingEntry } from "./jig/types.ts";
import type { JigApi } from "./jig/types.ts";

export const ACME_ONBOARDING: OnboardingEntry = {
    preferredStore: "cmd",
    items: [
        {
            kind: "info",
            label: "Acme SSO",
            detail: "The acme-sso command signs you in; Jig reads only what it prints.",
        },
        {
            kind: "reference",
            section: "acme",
            path: "sso.token",
            label: "The Acme SSO token",
            why: "The gateway and the database tunnel sign in with it.",
            stores: ["cmd", "pass", "op", "env"],
            suggested: {
                cmd: "cmd:acme-sso",
                pass: "pass:acme/sso-token",
                op: "op://Work/acme-sso/token",
                env: "env:ACME_SSO_TOKEN",
            },
            addHints: {
                cmd: "acme-sso login",
                pass: "pass insert acme/sso-token",
                op: "Save the token as the token field of the acme-sso item in Work.",
                env: "export ACME_SSO_TOKEN=… where Pi starts.",
            },
        },
        {
            kind: "text",
            section: "acme",
            path: "bastion.user",
            label: "Your login on the bastion host",
            placeholder: "jdoe",
            why: "The staging and production databases go through the bastion.",
        },
        {
            kind: "login",
            tool: "gh",
            status: ["gh", "auth", "status"],
            login: "gh auth login",
            label: "GitHub login",
            why: "Pull requests, reviews and the release notes.",
        },
        {
            kind: "pick",
            section: "acme",
            path: "gateway.proxy",
            label: "How requests reach Acme's network",
            choices: ["http://127.0.0.1:3128", "http://127.0.0.1:3129"],
            why: "A sign-in proxy on this machine; 3129 is for the second workspace.",
        },
    ],
};

/** Registers the list through the API view this plugin was given. Older jig-core has no onboarding seam; nothing breaks. */
export function registerOnboarding(api: JigApi): void {
    api.onboarding?.register(ACME_ONBOARDING);
}

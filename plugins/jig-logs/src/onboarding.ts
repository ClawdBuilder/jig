// What a log search needs from a person, in plain questions, when no company plugin fills it in. The backend is one for
// the whole section, and each environment says where its own logs are; the sign-in forms are the methods `index.ts`
// declares (`LOGS_METHODS`).
import type { OnboardingSetup } from "../../jig-core/src/contract.ts";

export const LOGS_SETUP: OnboardingSetup = {
    summary: "Search logs by phrase or query.",
    items: [
        {
            kind: "pick",
            section: "logs",
            path: "backend.type",
            label: "Log backend",
            choices: ["elasticsearch", "loki"],
            why: "Each kind says where an environment's logs are with a different field.",
        },
        {
            kind: "text",
            section: "logs",
            path: "backend.url",
            label: "Backend address",
            placeholder: "https://logs.example.com:9200",
            why: "Every search goes here: https, and no user name or password in it.",
        },
        {
            kind: "object",
            section: "logs",
            path: "environments",
            label: "Log environment",
            why: "Each environment says where its logs are; its name is what a search gives.",
            keyLabel: "Which environment?",
            keyPlaceholder: "staging",
            repeat: true,
            forms: [
                {
                    // The fallback: an Elasticsearch or OpenSearch backend is the one a section has without saying so.
                    label: "An Elasticsearch index",
                    fields: [
                        {
                            kind: "text",
                            path: "index",
                            label: "The index or pattern to search",
                            placeholder: "app-logs-*",
                            why: "The index that holds this environment's logs; a filter narrows an index that holds several.",
                        },
                    ],
                },
                {
                    label: "A Loki stream selector",
                    when: { path: "backend.type", equals: "loki" },
                    fields: [
                        {
                            kind: "text",
                            path: "selector",
                            label: "The streams to search",
                            placeholder: '{app="orders-api", env="staging"}',
                            why: "Only the configuration sets the streams; the model cannot widen them.",
                        },
                    ],
                },
            ],
        },
    ],
};

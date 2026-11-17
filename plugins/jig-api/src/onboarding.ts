// What a saved-request collection needs from a person, in plain questions, when no company plugin fills it in. A
// collection is one of the four sources `src/sources/` reads, added one at a time; the environment mapping is a plain
// string per name, and an unmapped name counts as production.
import type { OnboardingSetup } from "../../jig-core/src/contract.ts";

export const API_SETUP: OnboardingSetup = {
    summary: "Run saved HTTP requests from collections.",
    items: [
        {
            kind: "object",
            section: "api",
            path: "collections",
            label: "API collection",
            why: "A collection is a folder or file of saved requests; its name is what a call gives.",
            keyLabel: "Which name should the calls use?",
            keyPlaceholder: "orders",
            repeat: true,
            forms: [
                {
                    label: "A folder of .http request files",
                    fields: [
                        {
                            kind: "text",
                            path: "http",
                            label: "Where is the folder?",
                            placeholder: "~/work/orders-api/http",
                            why: "Every .http file in it and in its folders is a saved request.",
                        },
                    ],
                },
                {
                    label: "A Bruno collection",
                    fields: [
                        {
                            kind: "text",
                            path: "bruno",
                            label: "Where is the Bruno folder?",
                            placeholder: "~/work/orders-api/bruno",
                            why: "The folder Bruno keeps a collection in.",
                        },
                    ],
                },
                {
                    label: "A Postman collection file",
                    fields: [
                        {
                            kind: "text",
                            path: "postman",
                            label: "Where is the collection file?",
                            placeholder: "~/work/orders.postman_collection.json",
                            why: "An exported collection; an environment file per environment is added by hand.",
                        },
                    ],
                },
                {
                    label: "An OpenAPI file",
                    fields: [
                        {
                            kind: "text",
                            path: "openapi",
                            label: "Where is the OpenAPI file?",
                            placeholder: "~/work/orders/openapi.yaml",
                            why: "A JSON or YAML specification.",
                        },
                        {
                            kind: "text",
                            path: "environments",
                            label: "Which environment names does it run in?",
                            list: true,
                            placeholder: "Staging",
                            why: "OpenAPI lists the environments it may run in; each must also be mapped below.",
                        },
                    ],
                },
            ],
        },
        {
            kind: "entry",
            section: "api",
            path: "environments",
            label: "An environment mapping",
            keyLabel: "Which environment name do the collections use?",
            keyPlaceholder: "Staging",
            valueLabel: "Which Jig environment is it?",
            valuePlaceholder: "staging",
            optional: true,
            repeat: true,
            why: "An unmapped name counts as production, where writes are refused and results are masked.",
        },
    ],
};

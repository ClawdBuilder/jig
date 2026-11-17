// What a Mongo connection needs from a person, in plain questions, when no company plugin fills it in. One connection per
// environment, added one at a time; the section is `mongo.connections`, and a second one is asked again with a name.
import type { OnboardingSetup } from "../../jig-core/src/contract.ts";

export const MONGO_SETUP: OnboardingSetup = {
    summary: "Read and write MongoDB data.",
    items: [
        {
            kind: "object",
            section: "mongo",
            path: "connections",
            label: "Mongo connection",
            why: "One connection per environment; Jig opens it only when a call needs it.",
            keyLabel: "Which environment is this connection for?",
            keyPlaceholder: "staging",
            repeat: true,
            forms: [
                {
                    label: "Directly at its address",
                    who: "The database this machine can reach",
                    fields: [
                        {
                            kind: "text",
                            path: "uri",
                            label: "Where is the database?",
                            placeholder: "mongodb://db.staging.example.com:27017",
                            why: "The address only: the user and the password are their own answers.",
                        },
                        {
                            kind: "text",
                            path: "user",
                            label: "Which database user?",
                            placeholder: "agent",
                            why: "A read-only user is the safest choice for production.",
                        },
                        {
                            kind: "reference",
                            path: "password",
                            label: "The database password",
                            why: "Jig reads it when it connects and never keeps the value.",
                        },
                    ],
                },
                {
                    label: "Through an SSH host",
                    who: "A bastion that can reach the database",
                    fields: [
                        {
                            kind: "text",
                            path: "uri",
                            label: "Where is the database, on the far side?",
                            placeholder: "mongodb://db.internal:27017",
                            why: "One host and port: a forward reaches one, so a replica-set list and mongodb+srv do not work through it.",
                        },
                        {
                            kind: "text",
                            path: "user",
                            label: "Which database user?",
                            placeholder: "agent",
                            why: "A read-only user is the safest choice for production.",
                        },
                        {
                            kind: "reference",
                            path: "password",
                            label: "The database password",
                            why: "Jig reads it when it connects and never keeps the value.",
                        },
                        {
                            kind: "text",
                            path: "via.ssh.host",
                            label: "Which SSH host should Jig go through?",
                            placeholder: "bastion.example.com",
                            why: "The route to a database this machine cannot reach.",
                        },
                        {
                            kind: "text",
                            path: "via.ssh.user",
                            label: "Which user on that SSH host?",
                            placeholder: "agent",
                            why: "The login the forward opens; your own account is the safest.",
                        },
                        {
                            kind: "reference",
                            path: "via.ssh.key",
                            label: "The SSH key",
                            why: "Jig reads the key when it opens the forward; it never copies it.",
                        },
                    ],
                },
            ],
        },
    ],
};

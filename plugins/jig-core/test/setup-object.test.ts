// The `object` item: one named object of a map, asked as a name and one form's questions, written as one change. These
// use the three real setup lists (mongo, logs, api) and their own validators, so the written section is checked by the
// plugin that will read it.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { buildApi } from "../src/api.ts";
import type { SectionCheck } from "../src/config.ts";
import type { OnboardingMethod, OnboardingSetup } from "../src/contract.ts";
import { checkOnboarding } from "../src/onboarding.ts";
import { applyEntry, applyObject } from "../src/setup-answer.ts";
import { fieldForRefusal } from "../src/setup-ask-object.ts";
import { pluginLines } from "../src/setup-menu.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import type { SetupObjectForm } from "../src/setup-plan.ts";
import { sectionQuestions } from "../src/setup-section.ts";
import { runSetup, setupStateFrom } from "../src/setup.ts";
import type { SetupUi } from "../src/setup.ts";
import { createState, loadPersonalConfig } from "../src/state.ts";
import { validateApi } from "../../jig-api/src/config.ts";
import { API_METHODS } from "../../jig-api/src/index.ts";
import { API_SETUP } from "../../jig-api/src/onboarding.ts";
import { validateLogsSection } from "../../jig-logs/src/config.ts";
import { LOGS_METHODS } from "../../jig-logs/src/index.ts";
import { LOGS_SETUP } from "../../jig-logs/src/onboarding.ts";
import { validateMongo } from "../../jig-mongo/src/config.ts";
import { MONGO_SETUP } from "../../jig-mongo/src/onboarding.ts";
import { fakePi } from "./support/fake-pi.ts";

let home: string;
let file: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-setup-object-"));
    file = path.join(home, "jig.json");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A screen that answers by title and records what it saw; the plugin list takes one answer per visit. */
class ScriptedUi implements SetupUi {
    readonly seen: string[] = [];
    private answers: Array<{ when: RegExp; answer?: string }> = [];
    private readonly list: string[];
    /** What every confirm answers; the last one repeats. */
    private confirms: boolean[];

    constructor(list: string[] = ["Done"], confirms: boolean[] = [true]) {
        this.list = [...list];
        this.confirms = [...confirms];
    }

    /** An answer; left out, the question is cancelled, as Ctrl+C does. */
    reading(when: RegExp, answer?: string): this {
        this.answers.push({ when, answer });
        return this;
    }

    picking(when: RegExp, answer?: string): this {
        this.answers.push({ when, answer });
        return this;
    }

    notify(text: string): void {
        this.seen.push(`notify: ${text}`);
    }

    async select(title: string, options: string[]): Promise<string | undefined> {
        this.seen.push(`select: ${title} [${options.join(" | ")}]`);
        const index = this.answers.findIndex((one) => one.when.test(title));
        if (index < 0) return options[0];
        const [found] = this.answers.splice(index, 1);
        const answer = found?.answer;
        if (answer === undefined) return undefined;
        return options.find((one) => one.startsWith(answer));
    }

    async input(title: string, placeholder?: string): Promise<string | undefined> {
        this.seen.push(placeholder === undefined ? `input: ${title}` : `input: ${title} (${placeholder})`);
        const index = this.answers.findIndex((one) => one.when.test(title));
        if (index < 0) return undefined;
        const [found] = this.answers.splice(index, 1);
        return found?.answer;
    }

    async confirm(title: string): Promise<boolean> {
        this.seen.push(`confirm: ${title}`);
        return this.confirms.length > 1 ? (this.confirms.shift() ?? true) : (this.confirms[0] ?? true);
    }
}

/** The real mongo section: its questions and its own check, in a home whose `jig.json` holds `config`. */
function mongoState(config: unknown = {}, defaults?: unknown): ReturnType<typeof createState> {
    return pluginState("mongo", validateMongo, MONGO_SETUP, config, undefined, defaults);
}

/** The real logs section, with its sign-in methods. */
function logsState(config: unknown = {}): ReturnType<typeof createState> {
    return pluginState("logs", validateLogsSection, LOGS_SETUP, config, LOGS_METHODS);
}

/** The real api section, with its methods. */
function apiState(config: unknown = {}): ReturnType<typeof createState> {
    // A machine with `pass` on PATH, so a credential choice still has the built-in store to fall back on.
    return pluginState("api", validateApi, API_SETUP, config, API_METHODS);
}

function pluginState(
    section: string,
    check: SectionCheck,
    setup: OnboardingSetup,
    config: unknown,
    methods?: readonly OnboardingMethod[],
    defaults?: unknown,
): ReturnType<typeof createState> {
    writeFileSync(file, JSON.stringify(config));
    const state = createState(fakePi().pi, { env: {} });
    state.configPath = () => file;
    const api = buildApi(state);
    api.config.registerSection(section, check, {
        ...(methods === undefined ? {} : { methods }),
        setup,
    });
    // A company's defaults for this section: setup reads them under the person's own values.
    if (defaults !== undefined) state.sectionDefaults.set(section, defaults);
    loadPersonalConfig(state, file);
    return state;
}

describe("mongo's setup: one connection", () => {
    test("asks the name, then one form's three answers, and writes them as one connection", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database/, "mongodb://db.staging.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.mongo, {
            connections: {
                staging: {
                    uri: "mongodb://db.staging.example.com:27017",
                    user: "agent",
                    password: "env:MONGO_STAGING_PASSWORD",
                },
            },
        });
        assert.deepEqual(written.secrets.backends, ["pass", "env"], "the chosen store is turned on");
        const seen = ui.seen.join("\n");
        // It asked the location, never the value, and showed the store's own line to add it.
        assert.match(seen, /Where does the database password live\?/);
        assert.match(seen, /Set MONGO_STAGING_PASSWORD in the shell that starts Pi/);
        assert.doesNotMatch(seen, /Please enter.*password/i);
        assert.match(seen, /Not in an environment variable yet\./);
        // The credential's own why-line, before the store question, as a text question says it.
        const why = seen.indexOf("Jig reads it when it connects and never keeps the value.");
        const ask = seen.indexOf("select: Where does the database password live?");
        assert.ok(why >= 0 && why < ask, "the why-line comes before the store question");
    });

    test("one change, described by its name, not by the object's JSON", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database/, "mongodb://db.staging.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Mongo connection: staging \(not found yet\) \(new\)/);
        assert.doesNotMatch(seen, /\[object Object\]/);
    });

    test("repeat adds a second connection, through an SSH host", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [true, false, true])
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database\?/, "mongodb://db.staging.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .reading(/Which environment is this connection for/, "production")
            .picking(/Which kind of mongo connection/, "Through an SSH host")
            .reading(/Where is the database, on the far side/, "mongodb://db.internal:27017")
            .reading(/Which database user/, "agent-readonly")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_PROD_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .reading(/Which SSH host should Jig go through/, "bastion.example.com")
            .reading(/Which user on that SSH host/, "agent")
            .picking(/Where does the SSH key live/, "An environment variable")
            .reading(/Which environment variable/, "SSH_BASTION_KEY")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Add another Mongo connection\?/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(Object.keys(written.mongo.connections), ["staging", "production"]);
        assert.deepEqual(written.mongo.connections.production.via, {
            ssh: { host: "bastion.example.com", user: "agent", key: "env:SSH_BASTION_KEY" },
        });
        assert.equal(written.mongo.connections.production.user, "agent-readonly");
    });

    test("a mongodb+srv uri through an SSH route is asked again as the uri, not as the SSH host", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Through an SSH host")
            .reading(/Where is the database, on the far side/, "mongodb+srv://db.internal")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .reading(/Which SSH host should Jig go through/, "bastion.example.com")
            .reading(/Which user on that SSH host/, "agent")
            .picking(/Where does the SSH key live/, "An environment variable")
            .reading(/Which environment variable/, "SSH_BASTION_KEY")
            .picking(/Not found yet/, "Continue without it")
            // The refusal names `via.ssh`, which is above the fields; the field it is really about is the uri.
            .reading(/Where is the database, on the far side/, "mongodb://db.internal:27017")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /needs a uri with exactly one host and port/);
        assert.equal(
            (seen.match(/input: Where is the database, on the far side\?/g) ?? []).length,
            2,
            "the uri is asked again",
        );
        assert.equal(
            (seen.match(/input: Which SSH host should Jig go through\?/g) ?? []).length,
            1,
            "the SSH host, which cannot fix it, is asked once",
        );
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.mongo.connections.staging.uri, "mongodb://db.internal:27017");
        assert.equal(written.mongo.connections.staging.via.ssh.host, "bastion.example.com");
    });

    test("a name already in the map is refused before the answers are asked again", async () => {
        const state = mongoState({
            mongo: {
                connections: {
                    staging: {
                        uri: "mongodb://db.staging.example.com:27017",
                        user: "agent",
                        password: "env:MONGO_STAGING_PASSWORD",
                    },
                },
            },
        });
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "staging")
            .reading(/Which environment is this connection for/, "qa")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database\?/, "mongodb://db.qa.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_QA_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Already set up: staging\./);
        assert.match(seen, /staging is already set up here; use another name/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(Object.keys(written.mongo.connections), ["staging", "qa"]);
        assert.equal(written.mongo.connections.staging.uri, "mongodb://db.staging.example.com:27017");
    });

    test("a uri its own check refuses is asked again, with the plugin's words", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database\?/, "https://db.staging.example.com")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .reading(/Where is the database\?/, "mongodb://db.staging.example.com:27017")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Where is the database: must be a mongodb:\/\/ or mongodb\+srv:\/\/ address\./);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.mongo.connections.staging.uri, "mongodb://db.staging.example.com:27017");
    });

    test("a name its own check refuses is said whole, without the key's own colon", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "local")
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database\?/, "mongodb://db.staging.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            // The refusal comes after the whole form, so every answer is asked again for the name that is accepted.
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database\?/, "mongodb://db.staging.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Mongo connection local was not added: a database is a test or production environment/);
        assert.doesNotMatch(seen, /was not added: local:/, "the key's colon is not repeated");
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(Object.keys(written.mongo.connections), ["staging"]);
    });

    test("a name in a company's defaults is refused, and another one is asked", async () => {
        const state = mongoState(
            {},
            {
                connections: {
                    staging: {
                        uri: "mongodb://db.staging.example.com:27017",
                        user: "agent",
                        password: "env:MONGO_STAGING_PASSWORD",
                    },
                },
            },
        );
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which environment is this connection for/, "staging")
            .reading(/Which environment is this connection for/, "qa")
            .picking(/Which kind of mongo connection/, "Directly at its address")
            .reading(/Where is the database\?/, "mongodb://db.qa.example.com:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_QA_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Already set up: staging\./);
        assert.match(seen, /staging is already set up here; use another name/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(Object.keys(written.mongo.connections), ["qa"]);
    });

    test("two credentials with two stores turn both on, and the summary says so", async () => {
        const state = mongoState();
        const ui = new ScriptedUi(["Done"], [true, false, true])
            .reading(/Which environment is this connection for/, "staging")
            .picking(/Which kind of mongo connection/, "Through an SSH host")
            .reading(/Where is the database, on the far side/, "mongodb://db.internal:27017")
            .reading(/Which database user/, "agent")
            .picking(/Where does the database password live/, "An environment variable")
            .reading(/Which environment variable/, "MONGO_STAGING_PASSWORD")
            .picking(/Not found yet/, "Continue without it")
            .reading(/Which SSH host should Jig go through/, "bastion.example.com")
            .reading(/Which user on that SSH host/, "agent")
            .picking(/Where does the SSH key live/, "A file")
            // A path no machine has: the probe must say "not found" without reading anything under a real home.
            .reading(/Which file/, "/nonexistent/jig-setup/ssh-key")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Turn on an environment variable as a place Jig reads from\./);
        assert.match(seen, /Turn on a file as a place Jig reads from\./);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.secrets.backends, ["pass", "env", "file"]);
        assert.equal(written.mongo.connections.staging.password, "env:MONGO_STAGING_PASSWORD");
        assert.equal(written.mongo.connections.staging.via.ssh.key, "file:/nonexistent/jig-setup/ssh-key");
    });

    test("a map already set up can be left as it is, and the list says set up", async () => {
        const config = {
            mongo: {
                connections: {
                    staging: {
                        uri: "mongodb://db.staging.example.com:27017",
                        user: "agent",
                        password: "env:MONGO_STAGING_PASSWORD",
                    },
                },
            },
        };
        const state = mongoState(config);
        const ui = new ScriptedUi().reading(/Which environment is this connection for/, "");
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Already set up: staging\./);
        assert.match(seen, /Mongo connection left as it is\./);
        assert.match(seen, /Nothing was written\./);
    });

    test("the list says not set up until a connection is there", () => {
        const before = pluginLines(setupStateFrom(mongoState()), {});
        assert.equal(before.find((line) => line.label === "Mongo")?.status, "not set up");
        const after = pluginLines(
            setupStateFrom(
                mongoState({
                    mongo: {
                        connections: {
                            staging: {
                                uri: "mongodb://db.staging.example.com:27017",
                                user: "agent",
                                password: "env:MONGO_STAGING_PASSWORD",
                            },
                        },
                    },
                }),
            ),
            {},
        );
        assert.equal(after.find((line) => line.label === "Mongo")?.status, "set up");
    });

    test("an existing connection's missing field is still asked by the validator, with its words", () => {
        const state = mongoState({
            mongo: {
                connections: {
                    staging: { uri: "mongodb://db.staging.example.com:27017", user: "agent" },
                },
            },
        });
        const questions = sectionQuestions(setupStateFrom(state), "mongo", {}, true);
        const password = questions.fields.find((field) => field.path === "connections.staging.password");
        assert.equal(password?.kind, "reference", "the object item does not cover the paths below its map");
        assert.match(password?.question ?? "", /Where do you keep the Mongo connections staging password\?/);
        assert.ok(
            questions.fields.some((field) => field.kind === "object"),
            "and the map itself can still be added to",
        );
    });
});

describe("cancelling inside an object", () => {
    /** The file as it was before the run: a cancel anywhere inside an object writes none of it. */
    async function cancelled(ui: ScriptedUi): Promise<void> {
        const state = mongoState();
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 130, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Nothing was written\./);
        assert.equal(readFileSync(file, "utf8"), "{}");
    }

    test("at the name, at the kind, at a field and at a store", async () => {
        await cancelled(new ScriptedUi());
        await cancelled(
            new ScriptedUi()
                .reading(/Which environment is this connection for/, "staging")
                .picking(/Which kind of mongo connection/),
        );
        await cancelled(
            new ScriptedUi()
                .reading(/Which environment is this connection for/, "staging")
                .picking(/Which kind of mongo connection/, "Directly at its address")
                .reading(/Where is the database\?/),
        );
        await cancelled(
            new ScriptedUi()
                .reading(/Which environment is this connection for/, "staging")
                .picking(/Which kind of mongo connection/, "Directly at its address")
                .reading(/Where is the database\?/, "mongodb://db.staging.example.com:27017")
                .reading(/Which database user/, "agent")
                .picking(/Where does the database password live/),
        );
    });
});

describe("one named object's answers", () => {
    test("an unsafe field path inside the object is refused, and never pollutes Object.prototype", () => {
        const state = mongoState();
        const planState = setupStateFrom(state);
        planState.requestedSection = "mongo";
        const built = buildSetupPlan(planState);
        assert.ok("plan" in built, JSON.stringify(built));
        const field = built.plan.sections
            .find((section) => section.name === "mongo")
            ?.fields.find((one) => one.kind === "object");
        assert.ok(field, "mongo's object item is a field of its plan");
        const values = { uri: "mongodb://db.staging.example.com:27017", "__proto__.polluted": "yes" };
        let polluted: unknown;
        let refused = false;
        try {
            const answer = applyObject(built.plan, {}, field, "staging", values);
            refused = "problem" in answer;
            polluted = ({} as Record<string, unknown>).polluted;
        } finally {
            delete (Object.prototype as Record<string, unknown>).polluted;
        }
        assert.equal(polluted, undefined, "Object.prototype is untouched");
        assert.ok(refused, "an unsafe path inside the object is refused");
    });

    test("a refusal above the fields asks the field its words name, and the form when they name none", () => {
        const form: SetupObjectForm = {
            fields: [
                {
                    kind: "text",
                    path: "uri",
                    label: "Where is the database?",
                    question: "Where is the database?",
                    reason: "One address.",
                },
                {
                    kind: "text",
                    path: "via.ssh.host",
                    label: "Which SSH host should Jig go through?",
                    question: "Which SSH host should Jig go through?",
                    reason: "The route.",
                },
            ],
        };
        assert.equal(
            fieldForRefusal(form, "via.ssh", "needs a uri with exactly one host and port"),
            0,
            "the uri is what the message is about",
        );
        assert.equal(
            fieldForRefusal(form, "via", 'must be { "ssh": { ... } } or { "tunnel": "<name>" }'),
            -1,
            "no field can fix it, so the whole form is asked",
        );
        assert.equal(fieldForRefusal(form, "via.ssh.host", "is required"), 1, "the field the message names");
        assert.equal(fieldForRefusal(form, "via.ssh.host.port", "must be a port"), 1, "the field that owns the path");
    });

    test("a refusal above the fields that names no field asks the forms again", async () => {
        // A check that refuses a connection that is not routed: the message names `via`, above the direct form's fields.
        const check = (raw: unknown): string[] => {
            const connections = (raw as Record<string, any>)?.connections ?? {};
            return Object.entries(connections)
                .filter(([, value]) => (value as Record<string, unknown>)?.via === undefined)
                .map(([name]) => `acme.connections.${name}.via: must be an object with ssh or tunnel`);
        };
        const state = pluginState(
            "acme",
            check,
            {
                summary: "Talk to Acme.",
                items: [
                    {
                        kind: "object",
                        section: "acme",
                        path: "connections",
                        label: "Acme connection",
                        keyLabel: "Which environment?",
                        forms: [
                            { label: "Directly", fields: [{ kind: "text", path: "uri", label: "Where is it?" }] },
                            {
                                label: "Through a tunnel",
                                fields: [{ kind: "text", path: "via.tunnel", label: "Which tunnel?" }],
                            },
                        ],
                    },
                ],
            },
            {},
        );
        const ui = new ScriptedUi()
            .reading(/Which environment\?/, "staging")
            .picking(/Which kind of acme connection/, "Directly")
            .reading(/Where is it\?/, "mongodb://db.example.com:27017")
            .picking(/Which kind of acme connection/, "Through a tunnel")
            .reading(/Which tunnel\?/, "bastion")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "acme");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /must be an object with ssh or tunnel/);
        assert.equal(
            (seen.match(/select: Which kind of acme connection\?/g) ?? []).length,
            2,
            "the kind is asked again, not one field of it",
        );
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.acme.connections.staging, { via: { tunnel: "bastion" } });
    });

    test("a lone form whose when does not match says so before asking for a name", async () => {
        const state = pluginState(
            "acme",
            () => [],
            {
                summary: "Talk to Acme.",
                items: [
                    {
                        kind: "object",
                        section: "acme",
                        path: "connections",
                        label: "Acme connection",
                        keyLabel: "Which environment?",
                        forms: [
                            {
                                label: "One",
                                when: { path: "connections.type", equals: "loki" },
                                fields: [{ kind: "text", path: "uri", label: "Where is it?" }],
                            },
                        ],
                    },
                ],
            },
            { acme: { connections: { type: "elasticsearch" } } },
        );
        const ui = new ScriptedUi();
        const code = await runSetup(state, ui, "acme");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.doesNotMatch(seen, /input: Which environment\?/);
        assert.match(seen, /The settings already decide this, so there is nothing to ask for acme connection\./);
        assert.match(seen, /Nothing was written\./);
    });
});

describe("logs' setup: a backend and its environments", () => {
    test("Loki asks for a selector and never which kind the environment is", async () => {
        const state = logsState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .picking(/Log backend/, "loki")
            .reading(/Backend address/, "https://logs.example.com:3100")
            .reading(/Which environment\?/, "staging")
            .reading(/The streams to search/, '{app="orders-api", env="staging"}')
            .picking(/How do you sign in to Logs/, "Service token")
            .picking(/Where does the log service token live/, "An environment variable")
            .reading(/Which environment variable/, "LOGS_TOKEN")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "logs");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.doesNotMatch(seen, /Which kind of log environment/);
        assert.match(seen, /The streams to search/);
        assert.doesNotMatch(seen, /The index or pattern to search/);
        // The two company methods are not offered without a company plugin.
        assert.match(seen, /select: How do you sign in to Logs\? \[User name and password/);
        assert.doesNotMatch(seen, /Company sign-in service|Company transport/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.logs, {
            backend: { type: "loki", url: "https://logs.example.com:3100", auth: { token: "env:LOGS_TOKEN" } },
            environments: { staging: { selector: '{app="orders-api", env="staging"}' } },
        });
    });

    test("Elasticsearch asks for the index instead", async () => {
        const state = logsState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .picking(/Log backend/, "elasticsearch")
            .reading(/Backend address/, "https://logs.example.com:9200")
            .reading(/Which environment\?/, "staging")
            .reading(/The index or pattern to search/, "app-logs-*")
            .picking(/How do you sign in to Logs/, "API key")
            .picking(/Where does the log API key live/, "An environment variable")
            .reading(/Which environment variable/, "LOGS_KEY")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "logs");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.doesNotMatch(seen, /Which kind of log environment/);
        assert.doesNotMatch(seen, /The streams to search/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.logs.environments, { staging: { index: "app-logs-*" } });
        assert.deepEqual(written.logs.backend, {
            type: "elasticsearch",
            url: "https://logs.example.com:9200",
            auth: { apiKey: "env:LOGS_KEY" },
        });
    });

    test("two environments come from one repeat", async () => {
        const state = logsState();
        const ui = new ScriptedUi(["Done"], [true, false, true])
            .picking(/Log backend/, "elasticsearch")
            .reading(/Backend address/, "https://logs.example.com:9200")
            .reading(/Which environment\?/, "staging")
            .reading(/The index or pattern to search/, "app-logs-*")
            .reading(/Which environment\?/, "qa")
            .reading(/The index or pattern to search/, "app-logs-qa-*")
            .picking(/How do you sign in to Logs/, "Service token")
            .picking(/Where does the log service token live/, "An environment variable")
            .reading(/Which environment variable/, "LOGS_TOKEN")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "logs");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Add another Log environment\?/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(Object.keys(written.logs.environments), ["staging", "qa"]);
    });
});

describe("api's setup: a collection and an environment", () => {
    test("asks which kind of collection, then its folder, then the environment mapping", async () => {
        const state = apiState();
        const ui = new ScriptedUi(["Done"], [false, false, true])
            .reading(/Which name should the calls use/, "orders")
            .picking(/Which kind of API collection/, "A folder of .http")
            .reading(/Where is the folder/, "~/work/orders-api/http")
            .reading(/Which environment name do the collections use/, "Staging")
            .reading(/Which Jig environment is it/, "staging")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "api");
        assert.equal(code, 0, ui.seen.join("\n"));
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.api, {
            collections: { orders: { http: "~/work/orders-api/http" } },
            environments: { Staging: "staging" },
        });
        // No sign-in question: both of api's methods are a company's.
        assert.doesNotMatch(ui.seen.join("\n"), /How do you sign in to Api/);
    });

    test("an OpenAPI collection is not offered: setup does not ask for its servers", async () => {
        const state = apiState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which name should the calls use/, "orders")
            .picking(/Which kind of API collection/, "A Postman collection file")
            .reading(/Where is the collection file/, "~/work/orders.postman_collection.json")
            .reading(/Which environment name do the collections use/, "")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "api");
        assert.equal(code, 0, ui.seen.join("\n"));
        const kinds = ui.seen.find((line) => line.startsWith("select: Which kind of API collection?"));
        assert.ok(kinds, ui.seen.join("\n"));
        assert.match(kinds, /A Postman collection file/);
        assert.doesNotMatch(kinds, /OpenAPI/);
    });

    test("an environment mapping its own check refuses is asked again, and never saved", async () => {
        const state = apiState();
        const ui = new ScriptedUi(["Done"], [false, false, true])
            .reading(/Which name should the calls use/, "orders")
            .picking(/Which kind of API collection/, "A folder of .http")
            .reading(/Where is the folder/, "~/work/orders-api/http")
            .reading(/Which environment name do the collections use/, "Staging")
            .reading(/Which Jig environment is it/, "my env")
            .reading(/Which environment name do the collections use/, "Staging")
            .reading(/Which Jig environment is it/, "staging")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "api");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /must be a jig-core environment name/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.api.environments, { Staging: "staging" });
    });

    test("a path its own check refuses is asked again", async () => {
        const state = apiState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which name should the calls use/, "orders")
            .picking(/Which kind of API collection/, "A folder of .http")
            .reading(/Where is the folder/, "work/orders-api/http")
            .reading(/Where is the folder/, "~/work/orders-api/http")
            .reading(/Which environment name do the collections use/, "")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "api");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Where is the folder: must be an absolute path or start with ~\/\./);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.api.collections.orders.http, "~/work/orders-api/http");
    });

    test("a message about a sibling key with a dot in it does not refuse this entry", () => {
        const state = apiState();
        const planState = setupStateFrom(state);
        planState.requestedSection = "api";
        const built = buildSetupPlan(planState);
        assert.ok("plan" in built, JSON.stringify(built));
        const field = built.plan.sections
            .find((section) => section.name === "api")
            ?.fields.find((one) => one.kind === "entry");
        assert.ok(field, "the environment mapping is a field of api's plan");
        const draft = { api: { environments: { "Staging.Prod": "my env" } } };
        const answer = applyEntry(built.plan, draft, field, "Staging", "staging");
        assert.ok("change" in answer, JSON.stringify(answer));
        // A key with a space in it is still named whole by the plugin's message, and refused.
        const space = applyEntry(built.plan, draft, field, "My Staging", "my env");
        assert.ok("problem" in space, JSON.stringify(space));
        assert.match(space.problem, /must be a jig-core environment name/);
    });
});

describe("the object item at registration", () => {
    function check(items: unknown): string {
        try {
            checkOnboarding({ items });
            return "ok";
        } catch (error) {
            return (error as Error).message;
        }
    }

    test("a form's label is needed only when there is more than one", () => {
        const fields = [{ kind: "text", path: "uri", label: "Where is the database?" }];
        const one = {
            kind: "object",
            section: "mongo",
            path: "connections",
            label: "Mongo connection",
            keyLabel: "Which environment?",
            forms: [{ fields }],
        };
        assert.equal(check([one]), "ok");
        const two = { ...one, forms: [{ fields }, { fields }] };
        assert.match(check([two]), /forms\[1\]\.label: one line, needed when an object may take more than one form/);
    });

    test("a path with a prototype key, and a question asked twice, are refused", () => {
        const base = {
            kind: "object",
            section: "mongo",
            path: "connections",
            label: "Mongo connection",
            keyLabel: "Which environment?",
        };
        assert.match(
            check([{ ...base, forms: [{ fields: [{ kind: "text", path: "__proto__.uri", label: "Where?" }] }] }]),
            /forms\[0\]\.fields\[0\]\.path: a dotted path inside the new object/,
        );
        const twice = [
            { kind: "text", path: "uri", label: "Where is the database?" },
            { kind: "text", path: "uri", label: "And again?" },
        ];
        assert.match(check([{ ...base, forms: [{ fields: twice }] }]), /is asked twice/);
    });

    test("a when names a path inside the section, never a prototype key", () => {
        const item = {
            kind: "object",
            section: "logs",
            path: "environments",
            label: "Log environment",
            keyLabel: "Which environment?",
            forms: [
                {
                    label: "One",
                    when: { path: "__proto__.type", equals: "loki" },
                    fields: [{ kind: "text", path: "selector", label: "Streams" }],
                },
                { label: "Two", fields: [{ kind: "text", path: "index", label: "Index" }] },
            ],
        };
        assert.match(check([item]), /forms\[0\]\.when\.path: a dotted path inside the section/);
    });

    test("a reference field may name its stores, and a plugin cannot choose one for the person", () => {
        const item = {
            kind: "object",
            section: "mongo",
            path: "connections",
            label: "Mongo connection",
            keyLabel: "Which environment?",
            forms: [
                {
                    fields: [{ kind: "reference", path: "password", label: "The password", stores: ["pass", "env"] }],
                },
            ],
        };
        assert.equal(check([item]), "ok");
        const preferred = {
            ...item,
            forms: [
                { fields: [{ kind: "reference", path: "password", label: "The password", preferredStore: "pass" }] },
            ],
        };
        assert.match(check([preferred]), /preferredStore: unknown field/);
    });
});

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
import { pluginLines } from "../src/setup-menu.ts";
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
    private answers: Array<{ when: RegExp; answer: string }> = [];
    private readonly list: string[];
    /** What every confirm answers; the last one repeats. */
    private confirms: boolean[];

    constructor(list: string[] = ["Done"], confirms: boolean[] = [true]) {
        this.list = [...list];
        this.confirms = [...confirms];
    }

    reading(when: RegExp, answer: string): this {
        this.answers.push({ when, answer });
        return this;
    }

    picking(when: RegExp, answer: string): this {
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
        return options.find((one) => one.startsWith(found?.answer ?? ""));
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
function mongoState(config: unknown = {}): ReturnType<typeof createState> {
    return pluginState("mongo", validateMongo, MONGO_SETUP, config);
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
): ReturnType<typeof createState> {
    writeFileSync(file, JSON.stringify(config));
    const state = createState(fakePi().pi, { env: {} });
    state.configPath = () => file;
    const api = buildApi(state);
    api.config.registerSection(section, check, {
        ...(methods === undefined ? {} : { methods }),
        setup,
    });
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
        assert.match(seen, /Mongo connection: staging \(new\)/);
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

    test("an OpenAPI file asks for its environment names as a list", async () => {
        const state = apiState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which name should the calls use/, "catalog")
            .picking(/Which kind of API collection/, "An OpenAPI file")
            .reading(/Where is the OpenAPI file/, "~/work/catalog/openapi.yaml")
            .reading(/Which environment names does it run in/, "Staging, Prod")
            .reading(/Which environment name do the collections use/, "")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "api");
        assert.equal(code, 0, ui.seen.join("\n"));
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.api.collections.catalog, {
            openapi: "~/work/catalog/openapi.yaml",
            environments: ["Staging", "Prod"],
        });
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

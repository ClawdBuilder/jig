// Setup asks for a session relay (jig-core's own `transports` section), looks once at whether it is running, and then
// offers Jira and logs a sign-in "through a session relay" to a person with no company plugin, as soon as a transport
// exists: in the person's file, in a company's defaults, registered by a company plugin, or answered earlier in the run.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { buildApi } from "../src/api.ts";
import { checkOnboarding } from "../src/onboarding.ts";
import { applyObject } from "../src/setup-answer.ts";
import { DONE_LINE, LIST_TITLE, pluginLines } from "../src/setup-menu.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import { checkRelay } from "../src/setup-relay-check.ts";
import { sectionQuestions } from "../src/setup-section.ts";
import { runSetup, setupStateFrom } from "../src/setup.ts";
import type { SetupUi } from "../src/setup.ts";
import { createState, loadPersonalConfig } from "../src/state.ts";
import { validateJira } from "../../jig-jira/src/config.ts";
import { JIRA_METHODS } from "../../jig-jira/src/index.ts";
import { JIRA_SETUP } from "../../jig-jira/src/onboarding.ts";
import { validateLogsSection } from "../../jig-logs/src/config.ts";
import { OPS_REPLACE, validateOps } from "../../jig-ops/src/catalog.ts";
import { OPS_METHODS } from "../../jig-ops/src/index.ts";
import { LOGS_METHODS } from "../../jig-logs/src/index.ts";
import { LOGS_SETUP } from "../../jig-logs/src/onboarding.ts";
import { fakePi } from "./support/fake-pi.ts";

let home: string;
let file: string;
/** The token file the tests point a relay at. Its first line is a stand-in that must never leave the machine. */
let tokenFile: string;
const TOKEN_LINE = ["relay", "token", "line"].join("-");

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-setup-relay-"));
    file = path.join(home, "jig.json");
    tokenFile = path.join(home, "relay-token");
    writeFileSync(tokenFile, `${TOKEN_LINE}\n`, { mode: 0o600 });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A fake relay on 127.0.0.1 that answers `/v1/health` and remembers every request it was sent. */
let relay: Server;
let relayUrl = "";
let requests: Array<{ method: string; url: string; headers: IncomingMessage["headers"] }> = [];

before(async () => {
    relay = createServer((request, response) => {
        requests.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers });
        response.setHeader("content-type", "application/json");
        response.end(
            JSON.stringify({
                ok: true,
                protocol: 1,
                service: "orders-api relay",
                services: { jira: true, logs: false },
            }),
        );
    });
    await new Promise<void>((resolve) => relay.listen(0, "127.0.0.1", resolve));
    relayUrl = `http://127.0.0.1:${(relay.address() as AddressInfo).port}`;
});
after(() => relay.close());
beforeEach(() => {
    requests = [];
});

/** An address on this machine where nothing listens, so a health check is refused at once. */
async function closedUrl(): Promise<string> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return `http://127.0.0.1:${port}`;
}

/** A state with the real Jira and logs sections and no company plugin, over a settings file holding `config`. */
function stateWith(config: unknown = {}): ReturnType<typeof createState> {
    writeFileSync(file, JSON.stringify(config));
    const state = createState(fakePi().pi, { env: {} });
    state.configPath = () => file;
    const api = buildApi(state);
    api.config.registerSection("jira", validateJira, {
        replace: ["auth"],
        methods: JIRA_METHODS,
        setup: JIRA_SETUP,
    });
    api.config.registerSection("logs", validateLogsSection, {
        replace: ["backend.auth"],
        oneOf: [["backend.auth", "backend.transport"]],
        methods: LOGS_METHODS,
        setup: LOGS_SETUP,
    });
    loadPersonalConfig(state, file);
    return state;
}

/** A screen that answers by title and records what it saw; the plugin list takes one answer per visit. */
class ScriptedUi implements SetupUi {
    readonly seen: string[] = [];
    private answers: Array<{ when: RegExp; answer: string }> = [];
    private readonly list: string[];
    /** What each confirm answers, in turn; the last one repeats. */
    private readonly confirms: boolean[];

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
        if (title === LIST_TITLE) {
            const wanted = this.list.shift() ?? DONE_LINE;
            return options.find((one) => one.startsWith(wanted)) ?? DONE_LINE;
        }
        const index = this.answers.findIndex((one) => one.when.test(title));
        if (index < 0) return options[0];
        const [found] = this.answers.splice(index, 1);
        return options.find((one) => one.startsWith(found?.answer ?? "")) ?? options[0];
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

/** The answers of one relay at `url`, its token kept in the test's token file; the rest of the run saves it. */
function relayAnswers(ui: ScriptedUi, name: string, url: string): ScriptedUi {
    return ui
        .reading(/What do you call this relay/, name)
        .reading(/The relay's address/, url)
        .picking(/Where does the relay's token live/, "A file")
        .reading(/Which file/, tokenFile)
        .picking(/Review these changes/, "Save these changes");
}

function written(): Record<string, any> {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
}

const methodIds = (state: ReturnType<typeof createState>, section: string, raw: Record<string, unknown> = {}) =>
    sectionQuestions(setupStateFrom(state), section, raw, true).methods?.map((method) => method.id);

describe("a session relay in setup", () => {
    test("is one name, an address and where its token is kept, and is written as kind relay", async () => {
        const state = stateWith();
        const ui = relayAnswers(new ScriptedUi(), "orders-relay", relayUrl);
        const code = await runSetup(state, ui, "transports");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.deepEqual(written().transports, {
            "orders-relay": { kind: "relay", url: relayUrl, token: `file:${tokenFile}` },
        });
        const seen = ui.seen.join("\n");
        assert.match(seen, /Found: orders-api relay, protocol 1, services: jira, logs \(off\)\./);
        assert.match(
            seen,
            /Session relay: orders-relay \(new\)/,
            "the summary says the relay, never the token's place",
        );
        assert.doesNotMatch(seen, new RegExp(TOKEN_LINE), "the token line was never read");
        assert.doesNotMatch(readFileSync(file, "utf8"), new RegExp(TOKEN_LINE));
    });

    test("a file is the first choice for the token, as `A file`, and asks no warning", async () => {
        const state = stateWith();
        const ui = relayAnswers(new ScriptedUi(), "orders-relay", relayUrl);
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /select: Where does the relay's token live\? \[A file \| /);
        assert.doesNotMatch(seen, /not recommended/);
        assert.doesNotMatch(seen, /confirm: Use a file\?/);
        assert.equal(written().transports["orders-relay"].token, `file:${tokenFile}`);
    });

    test("another credential keeps the weak-choice label and its question", async () => {
        const state = stateWith();
        const ui = new ScriptedUi()
            .reading(/Your Jira address/, "https://jira.example.com")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Personal access token")
            .picking(/Where does the Jira personal access token live/, "A file")
            .reading(/Which file/, tokenFile)
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /A file \(not recommended\)/);
        assert.match(seen, /confirm: Use a file\?/);
    });

    test("the health check is one GET without the token, and nothing else is sent", async () => {
        const state = stateWith();
        const ui = relayAnswers(new ScriptedUi(), "orders-relay", relayUrl);
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        assert.equal(requests.length, 1, JSON.stringify(requests));
        assert.deepEqual([requests[0]?.method, requests[0]?.url], ["GET", "/v1/health"]);
        assert.equal(requests[0]?.headers.authorization, undefined, "no token is sent");
        assert.equal(JSON.stringify(requests).includes(TOKEN_LINE), false);
    });

    test("an address that is plain http away from this machine is refused and asked again", async () => {
        const state = stateWith();
        const ui = new ScriptedUi()
            .reading(/What do you call this relay/, "orders-relay")
            .reading(/The relay's address/, "http://relay.example.com:8700")
            .reading(/The relay's address/, relayUrl)
            .picking(/Where does the relay's token live/, "A file")
            .reading(/Which file/, tokenFile)
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /The relay's address: may use http only for 127\.0\.0\.1, localhost or \[::1\]/);
        assert.equal(written().transports["orders-relay"].url, relayUrl);
        assert.equal(requests.length, 1, "the refused address was never contacted");
    });

    test("an empty name leaves it unset, and nothing is written", async () => {
        const state = stateWith();
        const ui = new ScriptedUi().reading(/What do you call this relay/, "");
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(
            seen,
            /input: What do you call this relay\? \(optional: press Enter to leave it unset; for example orders-relay\)/,
        );
        assert.match(seen, /Session relay left unset \(optional\)\./);
        assert.match(seen, /Nothing was written\./);
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {});
    });

    test("a name that is already there is refused, and an empty name leaves the relay as it is", async () => {
        const state = stateWith({ transports: { "orders-relay": { kind: "relay", url: relayUrl } } });
        const ui = new ScriptedUi()
            .reading(/What do you call this relay/, "orders-relay")
            .reading(/What do you call this relay/, "");
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Already set up: orders-relay\./);
        assert.match(seen, /orders-relay is already set up here/);
        assert.match(seen, /Session relay left as it is\./);
        assert.equal(requests.length, 0);
    });

    test("a relay that does not answer can be checked again, left as it is, or cancel setup", async () => {
        const dead = await closedUrl();
        const left = relayAnswers(new ScriptedUi(), "orders-relay", dead).picking(
            /Relay not answering/,
            "Continue without it",
        );
        assert.equal(await runSetup(stateWith(), left, "transports"), 0, left.seen.join("\n"));
        assert.match(
            left.seen.join("\n"),
            new RegExp(`Not answering at ${dead}: .*Start it, or continue without it\\.`),
        );
        assert.equal(written().transports["orders-relay"].url, dead);

        const cancelled = relayAnswers(new ScriptedUi(), "other-relay", dead).picking(
            /Relay not answering/,
            "Cancel setup",
        );
        assert.equal(await runSetup(stateWith(written()), cancelled, "transports"), 130, cancelled.seen.join("\n"));
        assert.deepEqual(Object.keys(written().transports), ["orders-relay"], "a cancel writes nothing");
    });

    test("a relay that speaks another protocol is not taken for a working one", async () => {
        const odd = createServer((_request, response) => {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ ok: true, protocol: 2, service: "orders-api relay" }));
        });
        await new Promise<void>((resolve) => odd.listen(0, "127.0.0.1", resolve));
        const url = `http://127.0.0.1:${(odd.address() as AddressInfo).port}`;
        try {
            const ui = relayAnswers(new ScriptedUi(), "orders-relay", url).picking(
                /Relay speaks another protocol/,
                "Continue without it",
            );
            assert.equal(await runSetup(stateWith(), ui, "transports"), 0, ui.seen.join("\n"));
            assert.match(ui.seen.join("\n"), /speaks protocol 2; Jig knows protocol 1/);
        } finally {
            odd.close();
        }
    });

    test("is in the plugin list, as optional, and `set up` once a relay is there", () => {
        const plain = pluginLines(setupStateFrom(stateWith()), {});
        const line = plain.find((one) => one.section === "transports");
        assert.equal(line?.status, "ready (optional settings)");
        assert.match(line?.text ?? "", /A session relay: Jira and logs through a program that holds your session\.$/);
        const there = pluginLines(setupStateFrom(stateWith()), {
            transports: { "orders-relay": { kind: "relay", url: relayUrl } },
        });
        assert.equal(there.find((one) => one.section === "transports")?.status, "set up");
    });

    test("a relay in the file that fails its check is asked about in the main questions, field by field", async () => {
        const bad = { transports: { "orders-relay": { kind: "relay", url: "http://relay.example.com:8700" } } };
        const state = stateWith(bad);
        const built = buildSetupPlan(setupStateFrom(state));
        assert.ok("plan" in built, JSON.stringify(built));
        const section = built.plan.sections.find((one) => one.name === "transports");
        assert.deepEqual(
            section?.fields.map((field) => field.path),
            ["orders-relay.url"],
        );
        const ui = new ScriptedUi()
            .picking(/Transports needs 1 thing/, "Answer these")
            .reading(/Transports orders relay address/, relayUrl)
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui), 0, ui.seen.join("\n"));
        assert.equal(written().transports["orders-relay"].url, relayUrl);
    });

    test("is not asked in the main questions when nothing is wrong with it", () => {
        const built = buildSetupPlan(setupStateFrom(stateWith()));
        assert.ok("plan" in built, JSON.stringify(built));
        assert.equal(
            built.plan.sections.some((section) => section.name === "transports"),
            false,
        );
    });
});

describe("Jira and logs through a session relay", () => {
    const relays = { transports: { "orders-relay": { kind: "relay", url: "http://127.0.0.1:8700" } } };

    test("it is not offered while no transport exists, and the company-only sign-in service stays hidden", () => {
        const state = stateWith();
        assert.deepEqual(methodIds(state, "jira"), ["cloud-basic", "data-center-pat", "oauth"]);
        assert.deepEqual(methodIds(state, "logs"), ["basic", "api-key", "token"]);
    });

    test("it is offered to a person when their own file has a transport, as a pick of the names", () => {
        const state = stateWith(relays);
        assert.deepEqual(methodIds(state, "jira", relays), ["cloud-basic", "data-center-pat", "oauth", "transport"]);
        const jira = sectionQuestions(setupStateFrom(state), "jira", relays, true).methods?.find(
            (method) => method.id === "transport",
        );
        assert.deepEqual(
            jira?.fields.map((field) => [field.path, field.kind, field.choices, field.optional]),
            [
                ["auth.transport", "pick", ["orders-relay"], undefined],
                ["timeoutSeconds", "number", undefined, true],
            ],
        );
        assert.match(jira?.label ?? "", /Through a session relay or transport/);
        assert.deepEqual(methodIds(state, "logs", relays), ["basic", "api-key", "token", "transport"]);
    });

    test("it is offered when a company's defaults name a transport, and when a company plugin registered one", () => {
        const defaults = stateWith();
        defaults.sectionDefaults.set("transports", {
            "corp-relay": { kind: "relay", url: "https://relay.example.com" },
        });
        loadPersonalConfig(defaults, file);
        const fromDefaults = sectionQuestions(setupStateFrom(defaults), "jira", {}, true).methods?.find(
            (method) => method.id === "transport",
        );
        assert.deepEqual(fromDefaults?.fields[0]?.choices, ["corp-relay"]);

        const registered = stateWith();
        registered.transports.register("corp-proxy", { request: async () => ({ status: 200, headers: {}, body: "" }) });
        const fromCode = sectionQuestions(setupStateFrom(registered), "jira", {}, true).methods?.find(
            (method) => method.id === "transport",
        );
        assert.deepEqual(fromCode?.fields[0]?.choices, ["corp-proxy"]);
    });

    test("a relay the file declares is listed once, not again as a transport a plugin registered", () => {
        const state = stateWith(relays);
        const pick = sectionQuestions(setupStateFrom(state), "jira", relays, true).methods?.find(
            (method) => method.id === "transport",
        );
        assert.deepEqual(pick?.fields[0]?.choices, ["orders-relay"]);
    });

    test("a company's own fixed transport is still offered with no transport in any file, and asks nothing", () => {
        const state = stateWith();
        const onboarding = checkOnboarding(
            {
                items: [],
                methods: {
                    jira: {
                        default: "transport",
                        add: [
                            {
                                id: "transport",
                                label: "Company transport",
                                fields: [
                                    {
                                        kind: "text",
                                        path: "auth.transport",
                                        label: "The transport",
                                        value: "corp-proxy",
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
            new Map([["jira", JIRA_METHODS]]),
        );
        const setup = setupStateFrom(state);
        setup.onboarding = onboarding;
        const fixed = sectionQuestions(setup, "jira", {}, true).methods?.find((method) => method.id === "transport");
        assert.equal(fixed?.fields[0]?.fixed, "corp-proxy");
    });

    test("Jira writes jira.auth.transport from the pick", async () => {
        const state = stateWith(relays);
        const ui = new ScriptedUi()
            .reading(/Your Jira address/, "https://jira.example.com")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may most Jira requests take/, "")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().jira, { site: "https://jira.example.com", auth: { transport: "orders-relay" } });
        assert.match(
            ui.seen.join("\n"),
            /select: How do you sign in to Jira\? \[.*Through a session relay or transport/,
        );
        assert.match(ui.seen.join("\n"), /Jira request time limit \(seconds\) left unset \(optional\)\./);
    });

    test("Jira asks one optional time limit right after the relay pick, and writes it as a number", async () => {
        const state = stateWith(relays);
        const ui = new ScriptedUi()
            .reading(/Your Jira address/, "https://jira.example.com")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may most Jira requests take/, "200")
            .reading(/How long may most Jira requests take/, "soon")
            .reading(/How long may most Jira requests take/, "120")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().jira, {
            site: "https://jira.example.com",
            auth: { transport: "orders-relay" },
            timeoutSeconds: 120,
        });
        const seen = ui.seen.join("\n");
        assert.match(
            seen,
            /input: How long may most Jira requests take, in seconds\? \(optional: Enter keeps the default, 30\)$/m,
        );
        assert.ok(
            seen.indexOf("select: Relay or transport for Jira requests") <
                seen.indexOf("input: How long may most Jira"),
            "the time limit comes right after the relay pick",
        );
        assert.match(seen, /Jira request time limit \(seconds\) must be a whole number of seconds from 5 to 120\./);
        assert.match(seen, /Jira request time limit \(seconds\) must be a number\./);
        assert.match(seen, /Jira request time limit \(seconds\): 120 \(new\)/);
    });

    test("Jira asks no time limit for the other ways to sign in", async () => {
        const state = stateWith(relays);
        const ui = new ScriptedUi()
            .reading(/Your Jira address/, "https://jira.example.com")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Personal access token")
            .picking(/Where does the Jira personal access token live/, "An environment variable")
            .reading(/Which environment variable/, "JIRA_PAT")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        assert.doesNotMatch(ui.seen.join("\n"), /How long may most Jira requests take/);
        assert.equal(written().jira.timeoutSeconds, undefined);
    });

    test("logs writes logs.backend.transport from the pick", async () => {
        const state = stateWith(relays);
        // The first confirm is "Add another Log environment?"; the last is the save.
        const ui = new ScriptedUi(["Done"], [false, true])
            .picking(/Log backend/, "elasticsearch")
            .reading(/Backend address/, "https://logs.example.com:9200")
            .reading(/Which environment\?/, "staging")
            .reading(/The index or pattern to search/, "app-logs-*")
            .picking(/How do you sign in to Logs/, "Through a session relay")
            .picking(/Relay or transport for log searches/, "orders-relay")
            .reading(/How long may a log request take/, "")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "logs"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().logs.backend, {
            type: "elasticsearch",
            url: "https://logs.example.com:9200",
            transport: "orders-relay",
        });
        assert.equal(written().logs.timeoutSeconds, undefined, "left unset, so the default 30 applies");
    });

    test("logs asks one optional time limit right after the relay pick, and writes it as a number", async () => {
        const state = stateWith(relays);
        const ui = new ScriptedUi(["Done"], [false, true])
            .picking(/Log backend/, "elasticsearch")
            .reading(/Backend address/, "https://logs.example.com:9200")
            .reading(/Which environment\?/, "staging")
            .reading(/The index or pattern to search/, "app-logs-*")
            .picking(/How do you sign in to Logs/, "Through a session relay")
            .picking(/Relay or transport for log searches/, "orders-relay")
            .reading(/How long may a log request take/, "4")
            .reading(/How long may a log request take/, "90")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "logs"), 0, ui.seen.join("\n"));
        assert.equal(written().logs.timeoutSeconds, 90);
        const seen = ui.seen.join("\n");
        assert.match(
            seen,
            /input: How long may a log request take, in seconds\? \(optional: Enter keeps the default, 30\)$/m,
        );
        assert.match(seen, /Log request time limit \(seconds\) must be a whole number of seconds from 5 to 120\./);
        assert.ok(
            seen.indexOf("select: Relay or transport for log searches") < seen.indexOf("input: How long may a log"),
        );
    });

    test("a relay answered earlier in the same run makes Jira offer it, and one run writes both", async () => {
        const state = stateWith();
        const ui = relayAnswers(new ScriptedUi(["Transports", "Jira", "Done"]), "orders-relay", relayUrl)
            .reading(/Your Jira address/, "https://jira.example.com")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may most Jira requests take/, "");
        assert.equal(await runSetup(state, ui), 0, ui.seen.join("\n"));
        const saved = written();
        assert.deepEqual(saved.transports, {
            "orders-relay": { kind: "relay", url: relayUrl, token: `file:${tokenFile}` },
        });
        assert.deepEqual(saved.jira, { site: "https://jira.example.com", auth: { transport: "orders-relay" } });
    });

    test("Jira asked before the relay does not offer it, and says nothing about it", async () => {
        const state = stateWith();
        const ui = new ScriptedUi(["Jira", "Done"])
            .reading(/Your Jira address/, "https://jira.example.com")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Personal access token")
            .picking(/Where does the Jira personal access token live/, "An environment variable")
            .reading(/Which environment variable/, "JIRA_PAT")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui), 0, ui.seen.join("\n"));
        assert.doesNotMatch(ui.seen.join("\n"), /session relay or transport/);
    });
});

describe("what registration accepts for it", () => {
    test("a number field is a plugin method's, never a company's fixed one, and fileExpected is true or false", () => {
        const api = buildApi(createState(fakePi().pi, { env: {} }));
        const method = (fields: unknown[]) => [
            { id: "transport", label: "Through a transport", viaTransport: true, fields },
        ];
        const name = { kind: "text", path: "auth.transport", label: "Which" };
        assert.doesNotThrow(() =>
            api.config.registerSection("jira", validateJira, {
                methods: method([
                    name,
                    { kind: "number", path: "timeoutSeconds", label: "Seconds", optional: true },
                ]) as never,
            }),
        );
        assert.throws(
            () =>
                buildApi(createState(fakePi().pi, { env: {} })).config.registerSection("jira", validateJira, {
                    methods: method([name, { kind: "number", path: "timeoutSeconds", label: "Seconds" }]) as never,
                }),
            /every field after the transport's name must be optional/,
        );
        assert.throws(
            () =>
                checkOnboarding({
                    items: [],
                    methods: {
                        jira: {
                            add: [
                                {
                                    id: "x",
                                    label: "X",
                                    fields: [{ kind: "number", path: "a", label: "A", value: "1" }],
                                },
                            ],
                        },
                    },
                }),
            /fixes text, not a number/,
        );
        const object = (fileExpected: unknown) => ({
            kind: "object",
            section: "orders",
            path: "relays",
            label: "Relay",
            keyLabel: "Which?",
            forms: [{ fields: [{ kind: "reference", path: "token", label: "Token", fileExpected }] }],
        });
        assert.doesNotThrow(() => checkOnboarding({ items: [object(true)] }));
        assert.throws(() => checkOnboarding({ items: [object("yes")] }), /fileExpected: true or false/);
    });

    test("a method that goes through a transport has exactly one required text field", () => {
        const api = buildApi(createState(fakePi().pi, { env: {} }));
        const bad = [
            {
                id: "transport",
                label: "Through a transport",
                viaTransport: true,
                fields: [{ kind: "text", path: "auth.transport", label: "Which", optional: true }],
            },
        ];
        assert.throws(
            () => api.config.registerSection("jira", validateJira, { methods: bad as never }),
            /viaTransport/,
        );
    });

    test("a form's fixed value cannot also be a question, and an empty path is only for an object", () => {
        const object = (fixed: unknown) => ({
            kind: "object",
            section: "orders",
            path: "",
            label: "Order",
            keyLabel: "Which?",
            forms: [{ fixed, fields: [{ kind: "text", path: "kind", label: "Kind" }] }],
        });
        assert.throws(() => checkOnboarding({ items: [object({ kind: "relay" })] }), /is also asked/);
        assert.throws(() => checkOnboarding({ items: [object({ "a..b": "x" })] }), /dotted path/);
        assert.throws(() => checkOnboarding({ items: [object({ other: { deep: 1 } })] }), /one line of text/);
        assert.doesNotThrow(() => checkOnboarding({ items: [object({ other: "relay" })] }));
        assert.throws(
            () => checkOnboarding({ items: [{ kind: "text", section: "orders", path: "", label: "Name" }] }),
            /path/,
        );
    });
});

describe("review of the relay setup: what a name and an address may be", () => {
    /** An `orders` section whose map is `relays`, and whose check names a key as the validator does, with its text. */
    function ordersState(
        check: (raw: unknown) => readonly string[] = (raw) => {
            const relays = (raw as { relays?: Record<string, { url?: string }> }).relays ?? {};
            return Object.entries(relays)
                .filter(([, relay]) => !String(relay.url).startsWith("https://"))
                .map(([name]) => `orders.relays.${name}.url: must start with https://`);
        },
    ): ReturnType<typeof createState> {
        const state = stateWith();
        buildApi(state).config.registerSection("orders", check, {
            setup: {
                summary: "Order relays.",
                items: [
                    {
                        kind: "object",
                        section: "orders",
                        path: "relays",
                        label: "Order relay",
                        keyLabel: "Which relay?",
                        forms: [{ fields: [{ kind: "text", path: "url", label: "Its address" }] }],
                    },
                ],
            },
        });
        loadPersonalConfig(state, file);
        return state;
    }

    /** The object question of one section's plan, for a test that answers without a screen. */
    function objectField(state: ReturnType<typeof createState>, section: string) {
        const built = buildSetupPlan({ ...setupStateFrom(state), requestedSection: section });
        assert.ok("plan" in built, JSON.stringify(built));
        const field = built.plan.sections.find((one) => one.name === section)?.fields.find((one) => one.object);
        assert.ok(field !== undefined);
        return { plan: built.plan, field };
    }

    test("a name with a space, a slash, a non-ASCII letter or more than 40 characters is refused at the prompt", async () => {
        const state = stateWith();
        const ui = new ScriptedUi();
        for (const name of ["my relay", "a/b", "café", "x".repeat(41)]) ui.reading(/What do you call this relay/, name);
        relayAnswers(ui, "orders-relay", relayUrl);
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        const refusals = ui.seen.filter((line) => /may use only letters, digits, "-" and "_"/.test(line));
        assert.equal(refusals.length, 4, ui.seen.join("\n"));
        assert.match(refusals[0] ?? "", /up to 40 characters/);
        assert.deepEqual(Object.keys(written().transports), ["orders-relay"]);
        assert.equal(requests.length, 1, "only the good relay was asked");
    });

    test("the answer is refused for such a name too, where an answer is applied, with a non-loopback http address", () => {
        const { plan, field } = objectField(stateWith(), "transports");
        const asked = { kind: "relay", url: "http://relay.example.com:8700" };
        const refused = applyObject(plan, structuredClone(plan.raw), field, "my relay", asked);
        assert.ok("problem" in refused, JSON.stringify(refused));
        assert.match(refused.problem, /letters, digits/);
        const plain = applyObject(plan, structuredClone(plan.raw), field, "orders-relay", asked);
        assert.ok("problem" in plain && plain.at === "url", JSON.stringify(plain));
    });

    test("an address with a user name and a password is refused before anything is shown or sent", async () => {
        const { plan, field } = objectField(stateWith(), "transports");
        const secret = ["alice", "hunter2"].join(":");
        const asked = { kind: "relay", url: `http://${secret}@127.0.0.1:8700/some/path?x=1` };
        const refused = applyObject(plan, structuredClone(plan.raw), field, "orders-relay", asked);
        assert.ok("problem" in refused && refused.at === "url", JSON.stringify(refused));
        assert.doesNotMatch(refused.problem, /hunter2|alice/);
        // Setup's own look at the relay refuses it as well: nothing is sent, and the address is never echoed.
        const state = stateWith();
        const sent: string[] = [];
        state.http = {
            request: async (request: { url: string }) => {
                sent.push(request.url);
                throw new Error("down");
            },
        } as never;
        const ui = new ScriptedUi().picking(/Relay not answering/, "Continue without it");
        const outcome = await checkRelay(state, ui, asked.url);
        assert.equal(outcome, "refused");
        assert.deepEqual(sent, []);
        assert.doesNotMatch(ui.seen.join("\n"), /hunter2|alice/);
    });

    test("a key a validator's message names with a space is still matched, so the object is refused", async () => {
        const state = ordersState();
        const ui = new ScriptedUi()
            .reading(/Which relay\?/, "my relay")
            .reading(/Its address/, "http://relay.example.com")
            .reading(/Its address/, "https://relay.example.com")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "orders"), 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /must start with https/);
        assert.equal(written().orders.relays["my relay"].url, "https://relay.example.com");
    });

    test("a message about the object that names no field of it refuses the whole object, never accepts it", () => {
        const state = ordersState((raw) =>
            Object.hasOwn((raw as { relays?: object }).relays ?? {}, "my relay")
                ? ["orders.relays.my relay: is not allowed"]
                : [],
        );
        const { plan, field } = objectField(state, "orders");
        const refused = applyObject(plan, structuredClone(plan.raw), field, "my relay", {
            url: "https://x.example.com",
        });
        assert.ok("problem" in refused, JSON.stringify(refused));
        assert.equal("at" in refused, false);
    });
});

describe("review of the relay setup: a name a company's code registered", () => {
    test("a relay named like a transport a company plugin registered is refused at the prompt", async () => {
        const state = stateWith();
        state.transports.register("corp-proxy", { request: async () => ({ status: 200, headers: {}, body: "" }) });
        const ui = new ScriptedUi()
            .reading(/What do you call this relay/, "corp-proxy")
            .reading(/What do you call this relay/, "orders-relay")
            .reading(/The relay's address/, relayUrl)
            .picking(/Where does the relay's token live/, "A file")
            .reading(/Which file/, tokenFile)
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "transports"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Already set up: corp-proxy\./);
        assert.match(seen, /corp-proxy is a company's transport; choose another name\./);
        assert.deepEqual(Object.keys(written().transports), ["orders-relay"]);
    });
});

describe("review of the relay setup: signing in another way takes the old way's fields out", () => {
    const relays = { transports: { "orders-relay": { kind: "relay", url: "http://127.0.0.1:8700" } } };
    const jira = (auth: unknown) => ({ site: "https://jira.example.com", auth });

    test("Jira: from an email and a token to the relay, the email and the token are removed", async () => {
        const state = stateWith({ ...relays, jira: jira({ email: "me@example.com", token: "env:JIRA_TOKEN" }) });
        const ui = new ScriptedUi()
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may/, "")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().jira, jira({ transport: "orders-relay" }));
        assert.deepEqual(validateJira(written().jira), []);
        const seen = ui.seen.join("\n");
        assert.match(seen, /Your Jira email: removed/);
        assert.match(seen, /The Jira API token: removed/);
        assert.doesNotMatch(seen, /me@example\.com|JIRA_TOKEN/, "a removal never shows the value");
    });

    test("the exact change lists what is removed, by path and never by value", async () => {
        const state = stateWith({ ...relays, jira: jira({ email: "me@example.com", token: "env:JIRA_TOKEN" }) });
        const ui = new ScriptedUi()
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may/, "")
            .picking(/Review these changes/, "Show the exact change");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /Removed: jira\.auth\.email, jira\.auth\.token/);
        assert.doesNotMatch(seen, /me@example\.com|JIRA_TOKEN/);
    });

    test("Jira: from a personal access token to a token command, the token is removed", async () => {
        const state = stateWith({ jira: jira({ token: "env:JIRA_TOKEN" }) });
        const ui = new ScriptedUi()
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Token command")
            .picking(/Where does the OAuth token command live/, "An environment variable")
            .reading(/Which environment variable/, "JIRA_OAUTH")
            .picking(/Use the suggested place/, "Build it another way")
            .picking(/Not found yet/, "Continue without it")
            .reading(/Cloud site id/, "")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().jira, jira({ oauth: "env:JIRA_OAUTH" }), ui.seen.join("\n"));
        assert.deepEqual(validateJira(written().jira), []);
    });

    test("Jira: a setting beside the sign-in, the time limit, stays when the way to sign in changes", async () => {
        const state = stateWith({
            ...relays,
            jira: { ...jira({ transport: "orders-relay" }), timeoutSeconds: 90 },
        });
        const ui = new ScriptedUi()
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Personal access token")
            .picking(/Where does the Jira personal access token live/, "An environment variable")
            .reading(/Which environment variable/, "JIRA_PAT")
            .picking(/Use the suggested place/, "Build it another way")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().jira, { ...jira({ token: "env:JIRA_PAT" }), timeoutSeconds: 90 });
    });

    test("logs: from a user name and a password to the relay, the old auth is removed", async () => {
        const state = stateWith({
            ...relays,
            logs: {
                backend: {
                    type: "elasticsearch",
                    url: "https://logs.example.com:9200",
                    auth: { username: "reader", password: "env:LOGS_PASSWORD" },
                },
                environments: { staging: { index: "app-logs-*" } },
            },
        });
        const ui = new ScriptedUi()
            .reading(/Which environment\?/, "")
            .picking(/How do you sign in to Logs/, "Through a session relay")
            .picking(/Relay or transport for log searches/, "orders-relay")
            .reading(/How long may/, "")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "logs"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().logs.backend, {
            type: "elasticsearch",
            url: "https://logs.example.com:9200",
            transport: "orders-relay",
        });
        assert.deepEqual(validateLogsSection(written().logs), []);
    });

    test("ops, whose methods name a service with a `*`: the replaced fields go from the services the method is asked for", async () => {
        const state = stateWith();
        buildApi(state).config.registerSection("ops", validateOps, {
            replace: OPS_REPLACE,
            methods: OPS_METHODS,
            setup: { summary: "Ops." },
        });
        const gitlab = { system: "gitlab", url: "https://gitlab.example.com", project: "acme/orders" };
        const config = {
            ops: {
                services: {
                    web: {
                        ci: { ...gitlab, auth: { user: "ci-bot", token: "env:CI_TOKEN" } },
                        environments: { staging: { health: "https://example.test/health" } },
                    },
                },
            },
        };
        writeFileSync(file, JSON.stringify(config));
        loadPersonalConfig(state, file);
        const ui = new ScriptedUi()
            .picking(/How do you sign in to Ops/, "CI token")
            .picking(/Where does the CI token live/, "Keep the current place")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui, "ops"), 0, ui.seen.join("\n"));
        assert.deepEqual(written().ops.services.web.ci.auth, { token: "env:CI_TOKEN" }, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /The CI user name: removed/);
    });

    test("a way to sign in setup does not know about is not removed, and the section is refused in the validator's words", async () => {
        const state = stateWith({ ...relays, jira: jira({ signIn: "corp-sso" }) });
        const ui = new ScriptedUi()
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may/, "");
        assert.equal(await runSetup(state, ui, "jira"), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /use exactly one of signIn, transport, or token/);
        assert.match(seen, /Nothing was written\./);
        assert.deepEqual(written().jira, jira({ signIn: "corp-sso" }));
    });
});

describe("review of the relay setup: a wrong value is still asked while its method is not answered", () => {
    const relays = { transports: { "orders-relay": { kind: "relay", url: "http://127.0.0.1:8700" } } };

    test("a time limit outside 5 to 120 is asked on the main screen when a relay exists", () => {
        const config = {
            ...relays,
            jira: {
                site: "https://jira.example.com",
                auth: { email: "me@example.com", token: "env:JIRA_TOKEN" },
                timeoutSeconds: 500,
            },
        };
        const state = stateWith(config);
        const questions = sectionQuestions(setupStateFrom(state), "jira", config, false);
        assert.deepEqual(
            questions.fields.map((field) => [field.path, field.kind]),
            [
                ["timeoutSeconds", "number"],
                ["projects", "text"],
            ],
        );
        const logs = {
            ...relays,
            logs: {
                backend: { type: "elasticsearch", url: "https://logs.example.com:9200", transport: "orders-relay" },
                environments: { staging: { index: "app-logs-*" } },
                timeoutSeconds: 500,
            },
        };
        const asked = sectionQuestions(setupStateFrom(stateWith(logs)), "logs", logs, false);
        assert.ok(
            asked.fields.some((field) => field.path === "timeoutSeconds"),
            JSON.stringify(asked.fields.map((field) => field.path)),
        );
    });

    test("a token that is not a secret reference is asked where it is kept, as the sign-in question is not asked", () => {
        const config = {
            jira: {
                site: "https://jira.example.com",
                auth: { email: "me@example.com", token: "plain-value" },
            },
        };
        const questions = sectionQuestions(setupStateFrom(stateWith(config)), "jira", config, false);
        assert.equal(questions.askMethod, false);
        assert.deepEqual(
            questions.fields.map((field) => [field.path, field.kind]),
            [
                ["auth.token", "reference"],
                ["projects", "text"],
            ],
        );
    });

    test("the same wrong value is asked once more through the relay question, with the corrected value kept", async () => {
        const config = {
            ...relays,
            jira: {
                site: "https://jira.example.com",
                auth: { email: "me@example.com", token: "env:JIRA_TOKEN" },
                timeoutSeconds: 500,
            },
        };
        const state = stateWith(config);
        const ui = new ScriptedUi()
            .picking(/Jira needs/, "Answer these")
            .reading(/Jira timeout seconds/, "60")
            .reading(/Project keys to work in/, "")
            .picking(/Review these changes/, "Save these changes");
        assert.equal(await runSetup(state, ui), 0, ui.seen.join("\n"));
        assert.equal(written().jira.timeoutSeconds, 60);
    });
});

describe("review of the relay setup: the time limit's question", () => {
    const relays = { transports: { "orders-relay": { kind: "relay", url: "http://127.0.0.1:8700" } } };
    const site = { site: "https://jira.example.com" };

    async function jiraQuestion(timeoutSeconds: number | undefined): Promise<string> {
        const state = stateWith({
            ...relays,
            jira: { ...site, ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }) },
        });
        const ui = new ScriptedUi()
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Through a session relay")
            .picking(/Relay or transport for Jira requests/, "orders-relay")
            .reading(/How long may/, "");
        await runSetup(state, ui, "jira");
        return ui.seen.join("\n");
    }

    test("says what Enter keeps: the value in the file, or the default when it is unset", async () => {
        assert.match(
            await jiraQuestion(90),
            /input: How long may most Jira requests take, in seconds\? \(optional: Enter keeps 90\)$/m,
        );
        assert.match(
            await jiraQuestion(undefined),
            /input: How long may most Jira requests take, in seconds\? \(optional: Enter keeps the default, 30\)$/m,
        );
    });

    test("says that a Jira search has its own limit, and names the setting", async () => {
        assert.match(await jiraQuestion(undefined), /A search has its own limit, searchTimeoutSeconds/);
    });

    test("a number's default must be a number", () => {
        const api = buildApi(createState(fakePi().pi, { env: {} }));
        const method = (fallback: unknown) => [
            {
                id: "transport",
                label: "Through a transport",
                viaTransport: true,
                fields: [
                    { kind: "text", path: "auth.transport", label: "Which" },
                    { kind: "number", path: "timeoutSeconds", label: "Seconds", optional: true, default: fallback },
                ],
            },
        ];
        assert.doesNotThrow(() => api.config.registerSection("jira", validateJira, { methods: method(30) as never }));
        assert.throws(
            () => api.config.registerSection("jira", validateJira, { methods: method("30") as never }),
            /default: a number/,
        );
    });

    test("logs says what Enter keeps too", async () => {
        const state = stateWith({
            ...relays,
            logs: {
                backend: { type: "elasticsearch", url: "https://logs.example.com:9200" },
                environments: { staging: { index: "app-logs-*" } },
                timeoutSeconds: 45,
            },
        });
        const ui = new ScriptedUi()
            .reading(/Which environment\?/, "")
            .picking(/How do you sign in to Logs/, "Through a session relay")
            .picking(/Relay or transport for log searches/, "orders-relay")
            .reading(/How long may/, "");
        await runSetup(state, ui, "logs");
        assert.match(
            ui.seen.join("\n"),
            /input: How long may a log request take, in seconds\? \(optional: Enter keeps 45\)$/m,
        );
    });
});

describe("review of the relay setup: the look at the relay", () => {
    /** A relay that answers `/v1/health` with whatever `reply` says, for one test. */
    async function answering(
        reply: (response: import("node:http").ServerResponse) => void,
        run: (url: string) => Promise<void>,
    ): Promise<void> {
        const server = createServer((_request, response) => reply(response));
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
        } finally {
            server.close();
        }
    }

    test("says it is checking before it waits, and caps a long list of services", async () => {
        const services = Object.fromEntries(Array.from({ length: 3000 }, (_, index) => [`service-${index}`, true]));
        await answering(
            (response) => {
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify({ ok: true, protocol: 1, service: "orders", services }));
            },
            async (url) => {
                const ui = relayAnswers(new ScriptedUi(), "orders-relay", url);
                assert.equal(await runSetup(stateWith(), ui, "transports"), 0);
                const lines = ui.seen.filter((line) => line.startsWith("notify: Found:"));
                assert.equal(lines.length, 1);
                assert.ok((lines[0] ?? "").length < 500, `${(lines[0] ?? "").length} characters`);
                assert.match(lines[0] ?? "", /and 2990 more/);
                assert.ok(
                    ui.seen.findIndex((line) => /Checking the relay/.test(line)) <
                        ui.seen.findIndex((line) => line.startsWith("notify: Found:")),
                );
            },
        );
    });

    test("a right-to-left override in a service's name is not printed", async () => {
        await answering(
            (response) => {
                response.setHeader("content-type", "application/json");
                response.end(
                    JSON.stringify({ ok: true, protocol: 1, service: "orders‮gnp", services: { "jira‮": true } }),
                );
            },
            async (url) => {
                const ui = relayAnswers(new ScriptedUi(), "orders-relay", url);
                await runSetup(stateWith(), ui, "transports");
                assert.doesNotMatch(ui.seen.join("\n"), /‮/);
            },
        );
    });

    test("a relay that answered with another protocol, or with a refusal, is not called silent", async () => {
        await answering(
            (response) => {
                response.statusCode = 401;
                response.setHeader("content-type", "application/json");
                response.end(JSON.stringify({ message: "token required" }));
            },
            async (url) => {
                const ui = relayAnswers(new ScriptedUi(), "orders-relay", url).picking(/Relay/, "Continue without it");
                await runSetup(stateWith(), ui, "transports");
                const seen = ui.seen.join("\n");
                assert.doesNotMatch(seen, /Relay not answering|Start it/);
                assert.match(seen, /answered at .*token required/);
            },
        );
        await answering(
            (response) => {
                response.statusCode = 302;
                response.setHeader("location", "http://127.0.0.1:1/login");
                response.setHeader("content-type", "text/html");
                response.end("<html></html>");
            },
            async (url) => {
                const ui = relayAnswers(new ScriptedUi(), "orders-relay", url).picking(/Relay/, "Continue without it");
                await runSetup(stateWith(), ui, "transports");
                const seen = ui.seen.join("\n");
                assert.match(seen, /HTTP 302/);
                assert.equal(seen.split(url).length - 1, 1, "the address is said once");
            },
        );
    });
});

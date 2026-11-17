// What a plugin's own setup list does: a section nobody registered questions for is offered in setup's list, its questions
// are asked with its sign-in methods, and a field a method covers is never asked as raw text (the `{"jira": {}}` retry loop).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { buildApi } from "../src/api.ts";
import type { OnboardingItem } from "../src/contract.ts";
import { doctorContext } from "../src/doctor-checks.ts";
import { notSetupLines } from "../src/doctor-needs.ts";
import { DONE_LINE, LIST_TITLE, pluginLines } from "../src/setup-menu.ts";
import { checkOnboarding } from "../src/onboarding.ts";
import { buildSetupPlan } from "../src/setup-plan.ts";
import { loadPersonalConfig, createState } from "../src/state.ts";
import { sectionQuestions } from "../src/setup-section.ts";
import { runSetup, setupStateFrom } from "../src/setup.ts";
import type { SetupUi } from "../src/setup.ts";
import { validateJira } from "../../jig-jira/src/config.ts";
import { JIRA_METHODS } from "../../jig-jira/src/index.ts";
import { JIRA_SETUP } from "../../jig-jira/src/onboarding.ts";
import { validateGitSection } from "../../jig-git/src/config.ts";
import { GIT_SETUP } from "../../jig-git/src/onboarding.ts";
import { fakePi } from "./support/fake-pi.ts";

let home: string;
let file: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-plugin-setup-"));
    file = path.join(home, "jig.json");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A state with the real Jira section and questions, plus a plugin that needs nothing and one waiting for its questions. */
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
    api.config.registerSection("sandbox", () => [], {
        setup: { summary: "Run bash in a sandbox, with network and file rules." },
    });
    api.config.registerSection("mongo", () => [], {
        setup: {
            summary: "Read and write MongoDB data.",
            pending: { doc: "plugins/jig-mongo/README.md", example: { connections: {} } },
        },
    });
    loadPersonalConfig(state, file);
    return state;
}

/** A state with the real git section and questions; no `gh` on PATH unless a test gives it one. */
function gitState(config: unknown = {}, env: NodeJS.ProcessEnv = { PATH: "" }): ReturnType<typeof createState> {
    writeFileSync(file, JSON.stringify(config));
    const state = createState(fakePi().pi, { env });
    state.configPath = () => file;
    const api = buildApi(state);
    api.config.registerSection("git", validateGitSection, { first: ["accounts"], setup: GIT_SETUP });
    loadPersonalConfig(state, file);
    return state;
}

/** A screen that answers by title and records what it saw; the plugin list takes one answer per visit. */
class ScriptedUi implements SetupUi {
    readonly seen: string[] = [];
    private answers: Array<{ when: RegExp; answer: string }> = [];
    private readonly list: string[];
    /** What every confirm answers; a test can say no once. */
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

/** The answers of a run that sets Jira up through the list and saves it: site, email, environment variable, no projects. */
function jiraAnswers(): ScriptedUi {
    return new ScriptedUi(["Jira", "Done"])
        .reading(/Your Jira address/, "https://example.atlassian.net")
        .reading(/Your Jira email/, "jane@example.test")
        .reading(/Which environment variable/, "JIRA_API_TOKEN")
        .reading(/Project keys to work in/, "")
        .picking(/How do you sign in to Jira/, "Email and API token")
        .picking(/Where does the Jira API token live/, "An environment variable")
        .picking(/Not found yet/, "Continue without it")
        .picking(/Review these changes/, "Save these changes");
}

describe("the regression: a validator field a sign-in method covers", () => {
    test("is never asked as raw text: the sign-in method asks for it", async () => {
        const state = stateWith({ jira: {} });
        const seen: string[] = [];
        let inputs = 0;
        const ui: SetupUi = {
            notify: (text) => void seen.push(text),
            async select(title, options) {
                seen.push(`select: ${title}`);
                if (title === "Not found yet") return "Continue without it";
                return options[0];
            },
            async input(title) {
                seen.push(`input: ${title}`);
                if (++inputs > 6) return undefined;
                return /site/i.test(title) ? "https://example.atlassian.net" : "JIRA_API_TOKEN";
            },
            async confirm() {
                return false;
            },
        };
        const code = await runSetup(state, ui, "jira");
        assert.equal(code, 130, seen.join("\n"));
        assert.doesNotMatch(
            seen.join("\n"),
            /input: Jira auth/,
            'a text box cannot satisfy "must be an object", so the person would retry for ever',
        );
        assert.match(seen.join("\n"), /input: Your Jira address/);
    });
});

describe("a value that is there but wrong", () => {
    /** A Jira whose address its own check refuses: setup has to ask for it again, not treat it as answered. */
    const invalid = {
        jira: {
            site: "http://not-https.example",
            auth: { email: "jane@example.test", token: "env:JIRA_API_TOKEN" },
        },
    };

    test("is asked again in the plugin's words, and the answer is written", async () => {
        const state = stateWith(invalid);
        const ui = new ScriptedUi()
            .reading(/Your Jira address/, "https://example.atlassian.net")
            .reading(/Project keys to work in/, "")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /input: Your Jira address/, "the address is a question, not an answered item");
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.jira.site, "https://example.atlassian.net");
    });

    test("is asked again in a company's words when its list names the path", () => {
        const state = stateWith(invalid);
        state.onboarding = checkOnboarding({
            items: [
                {
                    kind: "text",
                    section: "jira",
                    path: "site",
                    label: "Your team's Jira address",
                    why: "Your team writes its tickets there.",
                },
            ],
        });
        const built = buildSetupPlan(setupStateFrom(state));
        assert.ok("plan" in built);
        const field = built.plan.sections
            .find((section) => section.name === "jira")
            ?.fields.find((one) => one.path === "site");
        assert.equal(field?.label, "Your team's Jira address");
        assert.equal(field?.question, "Your team's Jira address");
        assert.equal(field?.reason, "Your team writes its tickets there.");
    });
});

describe("the plugin list", () => {
    test("shows each plugin with its status, in the order setup gives them", () => {
        const state = stateWith({});
        const lines = pluginLines(setupStateFrom(state), {});
        assert.deepEqual(
            lines.map((line) => [line.label, line.status]),
            [
                ["Jira", "not set up"],
                ["Mongo", "not set up (questions coming)"],
                ["Sandbox", "ready"],
            ],
        );
        assert.match(lines[0]?.text ?? "", /^Jira\s+not set up\s+Read, search and comment on issues in your Jira\.$/);
    });

    test("says set up once the section passes its own check", () => {
        const state = stateWith({});
        const lines = pluginLines(setupStateFrom(state), {
            jira: { site: "https://example.atlassian.net", auth: { email: "j@example.test", token: "pass:work/j" } },
        });
        assert.equal(lines.find((line) => line.label === "Jira")?.status, "set up");
    });

    test("picking Jira asks its questions, returns to the list, and Done writes once", async () => {
        const state = stateWith({});
        const ui = jiraAnswers();
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.jira.site, "https://example.atlassian.net");
        assert.deepEqual(written.jira.projects, undefined, "the optional list was left unset");
        assert.equal(written.jira.auth.email, "jane@example.test");
        assert.equal(written.jira.auth.token, "env:JIRA_API_TOKEN");
        // Turning the environment on adds to the built-in default store, `pass`, and does not replace it.
        assert.deepEqual(written.secrets.backends, ["pass", "env"]);
        // It said how to add the missing secret, and never asked for its value.
        assert.match(ui.seen.join("\n"), /Add it with: export JIRA_API_TOKEN=… where Pi starts/);
        assert.doesNotMatch(ui.seen.join("\n"), /Please enter.*token/);
        // Back on the list, Jira says it is set up now.
        assert.match(ui.seen.join("\n"), /Jira\s+set up\s+Read, search and comment/);
    });

    test("a ready plugin says what it does and writes nothing", async () => {
        const state = stateWith({});
        const ui = new ScriptedUi(["Sandbox", "Done"]);
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Sandbox is ready: Run bash in a sandbox/);
        assert.match(ui.seen.join("\n"), /Nothing to ask; Jig's defaults apply\./);
        assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {});
    });

    test("a plugin waiting for its questions shows the page and a section to add by hand", async () => {
        const state = stateWith({});
        const ui = new ScriptedUi(["Mongo", "Done"]);
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Read plugins\/jig-mongo\/README\.md in the Jig package\./);
        assert.match(ui.seen.join("\n"), /"connections": \{\}/);
    });
});

describe("jig setup <section>", () => {
    test("asks only that section, with no list", async () => {
        const state = stateWith({});
        const ui = jiraAnswers();
        const code = await runSetup(state, ui, "jira");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.doesNotMatch(ui.seen.join("\n"), /which plugin do you want to set up/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.jira.auth.token, "env:JIRA_API_TOKEN");
    });

    test("says how to configure a plugin whose questions are still coming", async () => {
        const state = stateWith({});
        const ui = new ScriptedUi();
        const code = await runSetup(state, ui, "mongo");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Nothing to ask for mongo\./);
        assert.match(ui.seen.join("\n"), /Read plugins\/jig-mongo\/README\.md/);
    });

    test("a company default skips the question it already answers", async () => {
        const state = stateWith({});
        state.sectionDefaults.set("jira", { site: "https://example.atlassian.net" });
        loadPersonalConfig(state, file);
        const ui = new ScriptedUi()
            .reading(/Your Jira email/, "jane@example.test")
            .reading(/Which environment variable/, "JIRA_API_TOKEN")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Email and API token")
            .picking(/Where does the Jira API token live/, "An environment variable")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "jira");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.doesNotMatch(ui.seen.join("\n"), /input: Your Jira address/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.equal(written.jira.site, undefined, "the company's default stayed the default");
    });
});

describe("an entry of a map", () => {
    /** A section with one map of keys to values, so an entry can be asked without git's list. */
    function appState(config: unknown = { orders: {} }): ReturnType<typeof createState> {
        writeFileSync(file, JSON.stringify(config));
        const state = createState(fakePi().pi, { env: {} });
        state.configPath = () => file;
        const api = buildApi(state);
        api.config.registerSection(
            "orders",
            (raw) =>
                typeof raw === "object" && raw !== null && !Array.isArray(raw) && Object.keys(raw).length > 0
                    ? []
                    : ["orders must name an account"],
            {
                setup: {
                    summary: "Read the orders of an account.",
                    items: [
                        {
                            kind: "entry",
                            section: "orders",
                            path: "accounts",
                            label: "Which account do you read orders from?",
                            keyLabel: "Which application?",
                            keyPlaceholder: "shop",
                            valueLabel: "Which account?",
                            valuePlaceholder: "acme",
                            repeat: true,
                        },
                    ],
                },
            },
        );
        loadPersonalConfig(state, file);
        return state;
    }

    test("asks for one key and value, writes them into the map, and asks for another", async () => {
        const state = appState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which application/, "shop")
            .reading(/Which account/, "acme")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "orders");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Add another entry\?/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.orders, { accounts: { shop: "acme" } });
    });

    test("keeps an existing entry and adds a second one", async () => {
        const state = appState({ orders: { accounts: { shop: "acme" } } });
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which application/, "reports")
            .reading(/Which account/, "acme-read")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "orders");
        assert.equal(code, 0, ui.seen.join("\n"));
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.orders.accounts, { shop: "acme", reports: "acme-read" });
    });

    test("refuses a key that is not a plain name, and a value its own check refuses", async () => {
        const state = appState();
        const ui = new ScriptedUi(["Done"], [false, true])
            .reading(/Which application/, "__proto__")
            .reading(/Which account/, "acme")
            .reading(/Which application/, "shop")
            .reading(/Which account/, "acme")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "orders");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /That name cannot be used\./);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.orders, { accounts: { shop: "acme" } });
        assert.equal(Object.hasOwn(written.orders.accounts, "__proto__"), false);
    });
});

describe("git's setup", () => {
    test("without accounts it is ready (optional settings), and one mapping is the only question", () => {
        const state = gitState();
        const lines = pluginLines(setupStateFrom(state), {});
        assert.deepEqual(
            lines.map((line) => [line.label, line.status]),
            [["Git", "ready (optional settings)"]],
        );
        assert.match(lines[0]?.text ?? "", /^Git\s+ready \(optional settings\)\s+Work with git/);
        const questions = sectionQuestions(setupStateFrom(state), "git", {}, true);
        assert.deepEqual(
            questions.fields.map((field) => field.path),
            ["accounts"],
        );
        const field = questions.fields[0];
        assert.equal(field?.kind, "entry");
        assert.equal(field?.optional, true);
        assert.equal(field?.entry?.keyLabel, "Which repositories?");
        assert.equal(field?.entry?.keyPlaceholder, "github.com:acme/*");
        assert.equal(field?.entry?.valueLabel, "Which gh account?");
        assert.equal(field?.entry?.detect, "gh-account");
        assert.equal(field?.entry?.repeat, true);
    });

    test("jira, whose questions are required, is still not set up", () => {
        const lines = pluginLines(setupStateFrom(stateWith({})), {});
        assert.equal(lines.find((line) => line.label === "Jira")?.status, "not set up");
    });

    test("the doctor gives it no not-set-up line", () => {
        const lines: Array<{ title: string; detail: string }> = [];
        notSetupLines(doctorContext(gitState()), ["git"], lines as never);
        assert.deepEqual(lines, [], "nothing to fix: git runs on its defaults until a mapping is wanted");
    });

    test("with accounts it is set up, and setup asks nothing for it", () => {
        const state = gitState({ git: { accounts: { "github.com:acme/*": "acme-work" } } });
        const lines = pluginLines(setupStateFrom(state), {});
        assert.deepEqual(
            lines.map((line) => [line.label, line.status]),
            [["Git", "set up"]],
        );
        const built = buildSetupPlan(setupStateFrom(state));
        assert.ok("plan" in built);
        assert.deepEqual(
            built.plan.sections.filter((section) => section.name === "git"),
            [],
        );
    });

    test("picking Git asks the login and one mapping, and done writes it", async () => {
        const state = gitState();
        const ui = new ScriptedUi(["Git", "Done"], [false, true])
            .reading(/Which repositories/, "github.com:acme/*")
            .reading(/Which gh account/, "acme-work")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(
            seen,
            /notify: GitHub login: gh is not installed; install it, then run `gh auth login` in another/,
        );
        assert.doesNotMatch(seen, /Found on this machine/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.git, { accounts: { "github.com:acme/*": "acme-work" } });
        assert.match(seen, /Git\s+set up/, "the list says set up without leaving setup");
    });

    test("repeat adds a second mapping, and the map stays in the order it was written", async () => {
        const state = gitState();
        const ui = new ScriptedUi(["Git", "Done"], [true, false, true])
            .reading(/Which repositories/, "github.com:acme/*")
            .reading(/Which gh account/, "acme-work")
            .reading(/Which repositories/, "github.com:acme/svc")
            .reading(/Which gh account/, "acme-svc")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Add another entry\?/);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(Object.keys(written.git.accounts), ["github.com:acme/*", "github.com:acme/svc"]);
        assert.deepEqual(written.git.accounts, {
            "github.com:acme/*": "acme-work",
            "github.com:acme/svc": "acme-svc",
        });
    });

    test("a detected account is offered, and Enter takes it", async () => {
        const bin = path.join(home, "bin");
        mkdirSync(bin);
        const gh = path.join(bin, "gh");
        writeFileSync(gh, '#!/bin/sh\necho "  ✓ Logged in to github.com account acme-work (keyring)"\n');
        chmodSync(gh, 0o755);
        const state = gitState({}, { PATH: bin });
        const ui = new ScriptedUi(["Git", "Done"], [false, true])
            .reading(/Which repositories/, "github.com:acme/*")
            .reading(/Which gh account/, "")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui);
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /notify: Found on this machine: acme-work/);
        assert.match(seen, /notify: GitHub login: run `gh auth login` in another terminal\./);
        const written = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
        assert.deepEqual(written.git.accounts, { "github.com:acme/*": "acme-work" });
    });

    test("jig setup git asks the login and the mapping without the list", async () => {
        const state = gitState();
        const ui = new ScriptedUi([], [false, true])
            .reading(/Which repositories/, "github.com:acme/*")
            .reading(/Which gh account/, "acme-work")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "git");
        assert.equal(code, 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.doesNotMatch(seen, /which plugin do you want to set up/);
        assert.match(seen, /GitHub login: gh is not installed/);
    });
});

describe("picking a plugin that is already set up", () => {
    test("asks its method again and keeps what Enter leaves", async () => {
        writeFileSync(
            file,
            JSON.stringify({
                jira: {
                    site: "https://example.atlassian.net",
                    auth: { email: "jane@example.test", token: "env:JIRA_API_TOKEN" },
                },
            }),
        );
        const state = stateWith({
            jira: {
                site: "https://example.atlassian.net",
                auth: { email: "jane@example.test", token: "env:JIRA_API_TOKEN" },
            },
        });
        const ui = new ScriptedUi()
            .reading(/Your Jira email/, "")
            .reading(/Project keys to work in/, "")
            .picking(/How do you sign in to Jira/, "Email and API token")
            .picking(/Where does the Jira API token live/, "Keep the current place");
        const code = await runSetup(state, ui, "jira");
        assert.equal(code, 0, ui.seen.join("\n"));
        assert.match(ui.seen.join("\n"), /Your Jira email kept\./);
        assert.match(ui.seen.join("\n"), /Nothing was written\./);
    });
});

/** A section whose one question is a credential, on a machine with more stores than the question offers. */
function ordersState(items: readonly OnboardingItem[]): ReturnType<typeof createState> {
    writeFileSync(file, JSON.stringify({ secrets: { commands: { gh: ["gh", "auth", "token"] } } }));
    const state = createState(fakePi().pi, { env: {} });
    state.configPath = () => file;
    const api = buildApi(state);
    api.config.registerSection("orders", () => [], {
        setup: { summary: "Read the orders of an account.", items },
    });
    loadPersonalConfig(state, file);
    return state;
}

describe("an item's credential stores", () => {
    test("are the only places offered, as a method field's stores are", () => {
        const state = ordersState([
            {
                kind: "reference",
                section: "orders",
                path: "auth.token",
                label: "The orders token",
                stores: ["env"],
            },
        ]);
        const questions = sectionQuestions(setupStateFrom(state), "orders", {}, true);
        const field = questions.fields.find((one) => one.path === "auth.token");
        assert.equal(field?.kind, "reference");
        assert.deepEqual(field?.reference?.stores, ["env"], "only the store the question names is offered");
    });
});

describe("the words of a question", () => {
    test("the label is shown once: in the prompt, not in the line above it", async () => {
        const state = stateWith({});
        const ui = jiraAnswers();
        assert.equal(await runSetup(state, ui), 0, ui.seen.join("\n"));
        const seen = ui.seen.join("\n");
        assert.match(seen, /input: Your Jira address/);
        assert.doesNotMatch(seen, /notify: Your Jira address: Every request goes to this https address\./);
        assert.doesNotMatch(seen, /notify: Your Jira email: Jira Cloud signs each request with it\./);
        assert.match(seen, /notify: Every request goes to this https address\./, "the reason is still said");
    });

    test("an optional list shows one parenthetical, and its example is inside it", async () => {
        const state = stateWith({});
        const ui = jiraAnswers();
        assert.equal(await runSetup(state, ui), 0, ui.seen.join("\n"));
        const line = ui.seen.find((one) => one.startsWith("input: Project keys to work in"));
        assert.ok(line, ui.seen.join("\n"));
        assert.doesNotMatch(line, /\) \(/, "the optional marker and the example are not two parentheticals");
        assert.match(line, /\(optional: .*; for example PROJ, OPS\)$/);
    });

    test("the suggested-place question starts with a capital and names the store in a sentence", async () => {
        const state = ordersState([
            {
                kind: "reference",
                section: "orders",
                path: "auth.token",
                label: "The orders token",
                stores: ["env"],
                suggested: { env: "env:ORDERS_TOKEN" },
            },
        ]);
        const ui = new ScriptedUi()
            .picking(/Where does the orders token live/, "An environment variable")
            .picking(/use the suggested place/, "Use the variable")
            .picking(/Not found yet/, "Continue without it")
            .picking(/Review these changes/, "Save these changes");
        const code = await runSetup(state, ui, "orders");
        assert.equal(code, 0, ui.seen.join("\n"));
        const title = ui.seen.find((one) => one.startsWith("select: ") && one.includes("suggested place"));
        assert.match(
            title ?? "",
            /^select: Use the suggested place in an environment variable\? /,
            "the store is named in a sentence that starts with a capital",
        );
    });
});

describe("a plugin's sign-in methods", () => {
    test("a company-only form is offered only while a company is active", () => {
        const state = stateWith({});
        const plain = sectionQuestions(setupStateFrom(state), "jira", {}, true);
        assert.deepEqual(
            plain.methods?.map((method) => method.id),
            ["cloud-basic", "data-center-pat", "oauth"],
        );
        state.profile.selection = { reason: "explicit", plugin: "acme", profile: "acme", why: "test" };
        const withCompany = sectionQuestions(setupStateFrom(state), "jira", {}, true);
        assert.deepEqual(
            withCompany.methods?.map((method) => method.id),
            ["cloud-basic", "data-center-pat", "oauth", "sign-in-service", "transport"],
        );
    });
});

describe("what a plugin registration refuses", () => {
    function api() {
        return buildApi(createState(fakePi().pi, { env: {} }));
    }
    const base = { summary: "What it does." };

    test("a missing summary, an item for another section, a proposal, a preferred store, or pending questions", () => {
        assert.throws(
            () => api().config.registerSection("jira", validateJira, { setup: { summary: "" } }),
            /setup\.summary/,
        );
        assert.throws(
            () =>
                api().config.registerSection("jira", validateJira, {
                    setup: { ...base, items: [{ kind: "text", section: "git", path: "base", label: "Base" }] },
                }),
            /items\[0\]\.section: must be "jira"/,
        );
        assert.throws(
            () =>
                api().config.registerSection("jira", validateJira, {
                    setup: {
                        ...base,
                        items: [
                            {
                                kind: "proposal",
                                section: "startChecks",
                                value: { name: "VPN", tcp: "vpn.example.com:443" },
                                label: "A check",
                            },
                        ],
                    },
                }),
            /cannot propose an entry/,
        );
        assert.throws(
            () =>
                api().config.registerSection("jira", validateJira, {
                    setup: {
                        ...base,
                        items: [
                            {
                                kind: "reference",
                                section: "jira",
                                path: "auth.token",
                                label: "Token",
                                preferredStore: "pass",
                            },
                        ],
                    },
                }),
            /does not choose the person's secret store/,
        );
        assert.throws(
            () =>
                api().config.registerSection("jira", validateJira, {
                    setup: {
                        ...base,
                        items: [{ kind: "text", section: "jira", path: "site", label: "Site" }],
                        pending: { doc: "x.md", example: {} },
                    },
                }),
            /cannot also be waiting/,
        );
    });

    test("an item path setup cannot write, such as a prototype key or a list index", () => {
        for (const path of ["__proto__.polluted", "services.0.host"]) {
            assert.throws(
                () =>
                    api().config.registerSection("jira", validateJira, {
                        setup: { ...base, items: [{ kind: "text", section: "jira", path, label: "A value" }] },
                    }),
                /setup\.items\[0\]\.path/,
                path,
            );
        }
    });
});

describe("the doctor", () => {
    test("names a plugin with questions that is not set up, and runs its command", () => {
        const state = stateWith({});
        const context = doctorContext(state);
        const lines: Array<{ title: string; detail: string; level: string }> = [];
        notSetupLines(context, ["jira", "sandbox"], lines as never);
        assert.equal(lines.length, 2, JSON.stringify(lines));
        assert.equal(lines[0]?.level, "skip");
        assert.equal(lines[0]?.title, "jira");
        assert.equal(
            lines[0]?.detail,
            "not set up: Read, search and comment on issues in your Jira. Run jig setup jira.",
        );
        assert.equal(lines[1]?.title, "Not set");
        assert.equal(lines[1]?.detail, "sandbox; each plugin uses its defaults.");
    });

    test("a loaded plugin is not named as not set up", () => {
        const state = stateWith({
            jira: { site: "https://example.atlassian.net", auth: { email: "j@example.test", token: "pass:w/j" } },
        });
        const lines: Array<{ title: string }> = [];
        notSetupLines(doctorContext(state), ["jira"], lines as never);
        assert.deepEqual(lines, [], "a set-up plugin keeps its ordinary ok line");
    });
});

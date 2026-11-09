// The ticket view's pure reads: the key, the active entry, the folder, the title, the URL, the workflow stages and the
// files shown in the panel. Nothing here writes to a ticket.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
    activeTicket,
    isTicketKey,
    jiraUrl,
    observedPrs,
    readTicket,
    readWorkflow,
    stagesOf,
    ticketFiles,
    ticketsFolder,
    titleFromNotes,
    TICKET_ENTRY,
} from "../src/ticket.ts";

let root: string;
before(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-session-ticket-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

describe("the ticket key and the active entry", () => {
    test("a key is a short name, and the last entry wins, including off", () => {
        assert.equal(isTicketKey("PROJ-123"), true);
        assert.equal(isTicketKey("PROJ_1.a"), true);
        assert.equal(isTicketKey("-nope"), false);
        assert.equal(isTicketKey(""), false);
        assert.equal(isTicketKey(5), false);
        const entries = [
            { type: "custom", customType: TICKET_ENTRY, data: { key: "PROJ-1" } },
            { type: "message", message: { role: "user" } },
            { type: "custom", customType: TICKET_ENTRY, data: { key: "PROJ-2" } },
        ];
        assert.equal(activeTicket(entries), "PROJ-2");
        assert.equal(
            activeTicket([...entries, { type: "custom", customType: TICKET_ENTRY, data: { key: null } }]),
            undefined,
        );
        assert.equal(activeTicket([{ type: "custom", customType: TICKET_ENTRY, data: { key: "bad key" } }]), undefined);
        assert.equal(activeTicket([]), undefined);
    });

    test("the folder uses the configured one, else XDG, and expands a home path", () => {
        assert.equal(ticketsFolder({ folder: "/tmp/tickets" }, {}), "/tmp/tickets");
        assert.equal(ticketsFolder({}, { XDG_DATA_HOME: "/tmp/data" }), "/tmp/data/jig/tickets");
        assert.equal(ticketsFolder({}, { XDG_DATA_HOME: "relative" }).endsWith("/.local/share/jig/tickets"), true);
        assert.equal(ticketsFolder({ folder: "~/tickets" }, {}).endsWith("/tickets"), true);
    });
});

describe("the title, the URL and the workflow", () => {
    test("the first notes line gives a title after the key, and a bare key gives none", () => {
        assert.equal(titleFromNotes("# PROJ-1: Fix the login\nmore", "PROJ-1"), "Fix the login");
        assert.equal(titleFromNotes("# PROJ-1 - Fix the login", "PROJ-1"), "Fix the login");
        assert.equal(titleFromNotes("# PROJ-1 Fix the login", "PROJ-1"), "Fix the login");
        assert.equal(titleFromNotes("# PROJ-1", "PROJ-1"), undefined);
        assert.equal(titleFromNotes("# PROJ-10: Other", "PROJ-1"), undefined);
        assert.equal(titleFromNotes("x".repeat(250), "PROJ-1"), undefined);
        assert.equal(titleFromNotes(undefined, "PROJ-1"), undefined);
    });

    test("a Jira URL needs an https site", () => {
        assert.equal(
            jiraUrl({ site: "https://jira.example.test/" }, "PROJ-1"),
            "https://jira.example.test/browse/PROJ-1",
        );
        assert.equal(jiraUrl({ site: "http://jira.example.test" }, "PROJ-1"), undefined);
        assert.equal(jiraUrl({}, "PROJ-1"), undefined);
        assert.equal(
            jiraUrl({ site: "https://jira.example.test/path" }, "A B"),
            "https://jira.example.test/path/browse/A%20B",
        );
    });

    test("stages come from the last folder with the workflow file", () => {
        const one = path.join(root, "one");
        const two = path.join(root, "two");
        mkdirSync(one, { recursive: true });
        mkdirSync(two, { recursive: true });
        writeFileSync(path.join(one, "feature.json"), JSON.stringify({ stages: [{ id: "old", goal: "old" }] }));
        writeFileSync(
            path.join(two, "feature.json"),
            JSON.stringify({ stages: [{ id: "plan", goal: "Write it" }, { id: "done" }] }),
        );
        assert.deepEqual(stagesOf("feature", [one, two]), [{ id: "plan", goal: "Write it" }, { id: "done" }]);
        assert.deepEqual(stagesOf("feature", [two, one]), [{ id: "old", goal: "old" }]);
        assert.equal(stagesOf("missing", [one, two]), undefined);
        assert.equal(stagesOf("../bad", [one]), undefined);
    });

    test("workflow.json names the stage and the observed pull requests", () => {
        const dir = path.join(root, "tickets", "PROJ-1");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            path.join(dir, "workflow.json"),
            JSON.stringify({
                version: 1,
                workflow: "feature",
                stage: "build",
                stageSince: "2026-01-01T00:00:00Z",
                observed: {
                    "orders-api": {
                        branch: "feature/PROJ-1",
                        pr: {
                            number: 7,
                            state: "OPEN",
                            isDraft: false,
                            url: "https://github.com/acme/orders-api/pull/7",
                        },
                        checks: { pass: 2, fail: 0, pending: 1, total: 3 },
                        at: "2026-01-02T00:00:00Z",
                    },
                },
            }),
        );
        writeFileSync(path.join(root, "feature.json"), JSON.stringify({ stages: [{ id: "build" }] }));
        const view = readWorkflow(dir, [root]);
        assert.equal(view?.name, "feature");
        assert.equal(view?.current, "build");
        assert.deepEqual(view?.stages, [{ id: "build" }]);
        assert.deepEqual(view?.prs, [
            {
                repo: "orders-api",
                branch: "feature/PROJ-1",
                number: 7,
                state: "OPEN",
                draft: false,
                url: "https://github.com/acme/orders-api/pull/7",
                checks: { pass: 2, fail: 0, pending: 1, total: 3 },
                at: "2026-01-02T00:00:00Z",
            },
        ]);
        assert.equal(readWorkflow(path.join(root, "missing"), [root]), undefined);
    });

    test("readTicket joins the title, the URL and the workflow", () => {
        const folder = path.join(root, "tickets");
        const dir = path.join(folder, "PROJ-2");
        mkdirSync(path.join(dir, "evidence"), { recursive: true });
        writeFileSync(path.join(dir, "notes.md"), "# PROJ-2: Add a button\n");
        writeFileSync(path.join(dir, "plan.md"), "plan\n");
        writeFileSync(path.join(dir, "ticket.json"), "{}");
        writeFileSync(path.join(dir, "workflow.json"), "{}");
        writeFileSync(path.join(dir, "evidence", "line.txt"), "line\n");
        writeFileSync(path.join(dir, "evidence", "2026-01-01T00-00-00Z-mongo-abcdef.txt"), "captured\n");
        const viewed = readTicket("PROJ-2", folder, { site: "https://jira.example.test" }, []);
        assert.equal(viewed.ticket.title, "Add a button");
        assert.equal(viewed.ticket.url, "https://jira.example.test/browse/PROJ-2");
        assert.equal(viewed.workflow, undefined);
        const files = ticketFiles(dir).map((file) => path.basename(file.path));
        assert.deepEqual(files.sort(), ["line.txt", "notes.md", "plan.md"]);
    });

    test("observedPrs keeps only the fields it knows", () => {
        assert.deepEqual(observedPrs(undefined), []);
        assert.deepEqual(
            observedPrs({ "orders-api": { pr: { number: 1, url: "ftp://x" }, error: "no sign-in", extra: 1 } }),
            [{ repo: "orders-api", number: 1, state: "OPEN", draft: false, error: "no sign-in" }],
        );
    });
});

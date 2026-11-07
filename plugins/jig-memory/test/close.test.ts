import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { type CardFront, checkCard, draftCard, PLACEHOLDER, renderCard, SECTION_LIMIT } from "../src/card.ts";
import {
    CARD_FIX,
    CARD_REQUEST,
    correctionText,
    draftClose,
    draftPath,
    NothingToClose,
    requestText,
    verifyCard,
} from "../src/close.ts";
import { offeredTickets as sessionOffers } from "../src/session.ts";
import { ticketPaths } from "../src/store.ts";
import { ensureTicket } from "../src/store.ts";
import { changed, loadPlugin, PATTERN, tempFolder, useJig } from "./support.ts";

const read = (file: string) => readFileSync(file, "utf8");
const NOW = new Date("2026-10-31T10:15:00.000Z");
const SECTIONS = {
    Problem: "Cancelling an order with no customer returned 500.",
    Cause: "OrderMapper.toDto read the customer's name without a null check.",
    Fix: "The mapper returns an empty name when the customer is missing.",
};

function ticketWithNotes(folder: string, key = "PROJ-1"): ReturnType<typeof ticketPaths> {
    ensureTicket(folder, key);
    const paths = ticketPaths(folder, key);
    writeFileSync(paths.notes, `# ${key}\n\n## Now\nStatus: found it in OrderMapper\n`);
    return paths;
}

test("drafting a close writes the card with the front matter filled and placeholders in the sections", (t) => {
    const folder = tempFolder(t);
    const paths = ticketWithNotes(folder);
    const closing = draftClose(folder, "PROJ-1", undefined, NOW);
    assert.equal(read(draftPath(folder, "PROJ-1")), draftCard(closing.front));
    assert.equal(existsSync(paths.card), false);
    assert.deepEqual(closing.front.identifiers, ["OrderMapper"]);
    assert.equal(closing.corrected, false);
});

test("a ticket that is still the template has nothing to close", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-1");
    assert.throws(() => draftClose(folder, "PROJ-1", undefined, NOW), NothingToClose);
    assert.equal(existsSync(ticketPaths(folder, "PROJ-1").card), false);
});

test("closing again replaces the card with a new draft", (t) => {
    const folder = tempFolder(t);
    const paths = ticketWithNotes(folder);
    const first = draftClose(folder, "PROJ-1", undefined, NOW);
    writeFileSync(paths.card, renderCard(first.front, SECTIONS));
    writeFileSync(paths.notes, "# PROJ-1\n\nNow it is PaymentWorker too.\n");
    const second = draftClose(folder, "PROJ-1", undefined, new Date("2026-11-02T08:00:00.000Z"));
    assert.deepEqual(second.front.identifiers, ["PaymentWorker"]);
});

test("the request names the card, the notes and the limits; the correction lists what to change", (t) => {
    const folder = tempFolder(t);
    const paths = ticketPaths(folder, "PROJ-1");
    const request = requestText(folder, "PROJ-1");
    assert.match(request, /^\[ticket PROJ-1\] Closing the ticket\./);
    for (const text of [
        draftPath(folder, "PROJ-1"),
        paths.notes,
        "## Problem",
        "## Cause",
        "## Fix",
        `${SECTION_LIMIT} characters`,
    ]) {
        assert.ok(request.includes(text), text);
    }
    assert.equal(
        correctionText(folder, "PROJ-1", ["a.", "b."])
            .split("\n")
            .filter((line) => line.startsWith("- ")).length,
        2,
    );
});

test("verifying: a filled card passes, an unfilled one lists its problems, a missing one says so", (t) => {
    const folder = tempFolder(t);
    const paths = ticketWithNotes(folder);
    const closing = draftClose(folder, "PROJ-1", undefined, NOW);
    assert.equal(verifyCard(folder, closing).ok, false);
    assert.equal(verifyCard(folder, closing).problems.length, 3);
    writeFileSync(closing.draft, renderCard(closing.front, SECTIONS));
    assert.deepEqual(verifyCard(folder, closing), { ok: true, problems: [] });
    assert.deepEqual(checkCard(read(paths.card)).front, closing.front);
    writeFileSync(closing.draft, "");
    assert.match(verifyCard(folder, closing).problems[0] ?? "", /missing/);
});

test("front matter the agent damaged is written back from the draft when the sections are fine", (t) => {
    const folder = tempFolder(t);
    const paths = ticketWithNotes(folder);
    const closing = draftClose(folder, "PROJ-1", undefined, NOW);
    writeFileSync(closing.draft, `## Problem\na\n\n## Cause\nb\n\n## Fix\nc\n`);
    assert.equal(verifyCard(folder, closing).ok, true);
    const checked = checkCard(read(paths.card));
    assert.deepEqual(checked.front, closing.front);
    assert.deepEqual(checked.sections, { Problem: "a", Cause: "b", Fix: "c" });
});

test("front matter the agent changed but kept readable is left as it is", (t) => {
    const folder = tempFolder(t);
    const paths = ticketWithNotes(folder);
    const closing = draftClose(folder, "PROJ-1", undefined, NOW);
    const front: CardFront = { ...closing.front, identifiers: ["ByHand"] };
    writeFileSync(closing.draft, renderCard(front, SECTIONS));
    assert.equal(verifyCard(folder, closing).ok, true);
    assert.deepEqual(checkCard(read(paths.card)).front?.identifiers, ["ByHand"]);
});

// -- Through the session ---------------------------------------------------------------------------------------------

function start(t: Parameters<typeof tempFolder>[0]) {
    const folder = tempFolder(t);
    const jig = useJig(t, { memory: { ticketPattern: PATTERN, folder } });
    const pi = loadPlugin("/work");
    pi.start();
    return { folder, jig, pi };
}

test("/ticket close drafts the card, sends one follow-up message that starts an idle agent, and says so", async (t) => {
    const { folder, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "10:00:00 ERROR NullPointerException in OrderMapper", { action: "query" });
    const before = pi.sent.length;
    await pi.command("close");
    const paths = ticketPaths(folder, "PROJ-1");
    assert.equal(pi.sent.length, before + 1);
    const sent = pi.sent.at(-1);
    assert.equal(sent?.message.customType, CARD_REQUEST);
    assert.deepEqual(sent?.options, { triggerTurn: true, deliverAs: "followUp" });
    assert.deepEqual(sent?.message.details, { key: "PROJ-1" });
    assert.match(read(draftPath(folder, "PROJ-1")), /errors:\n {2}- "ERROR NullPointerException in OrderMapper"/);
    assert.equal(
        pi.notices.at(-1)?.text,
        `Card for PROJ-1 drafted in ${draftPath(folder, "PROJ-1")}; the agent is asked to fill it.`,
    );
});

test("when the agent has settled and the card is filled, it stays, and the active ticket is closed", async (t) => {
    const { folder, jig, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR boom in OrderMapper", { action: "query" });
    await pi.command("close");
    const paths = ticketPaths(folder, "PROJ-1");
    writeFileSync(
        draftPath(folder, "PROJ-1"),
        renderCard(checkCard(read(draftPath(folder, "PROJ-1"))).front as CardFront, SECTIONS),
    );
    pi.settle();
    assert.equal(pi.notices.at(-1)?.text, `Ticket PROJ-1 closed. Card: ${paths.card}`);
    assert.deepEqual(jig.tickets, ["PROJ-1", undefined]);
    const index = JSON.parse(readFileSync(path.join(folder, ".cards.json"), "utf8")) as {
        cards: Record<string, { valid: boolean; cause: string }>;
    };
    assert.deepEqual(Object.keys(index.cards), ["PROJ-1"], "the card is in the index at once");
    assert.equal(index.cards["PROJ-1"]?.cause, SECTIONS.Cause);
    assert.equal(pi.sent.length, 2, "notes and the request, and nothing else");
    assert.deepEqual(
        pi.log.filter((entry) => entry.type === "custom").map((entry) => entry.data),
        [{ key: "PROJ-1" }, { key: null }],
    );
    pi.settle();
    assert.equal(pi.sent.length, 2, "a later settle checks nothing");
});

test("a card left unfilled gets one correction message, then a warning and no more messages", async (t) => {
    const { folder, jig, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR boom", { action: "query" });
    await pi.command("close");
    pi.settle();
    const fix = pi.sent.at(-1);
    assert.equal(fix?.message.customType, CARD_FIX);
    assert.deepEqual(fix?.options, { triggerTurn: true, deliverAs: "followUp" });
    assert.match(fix?.message.content ?? "", /The section Problem still says \(not filled yet\)/);
    assert.match(pi.notices.at(-1)?.text ?? "", /^The card for PROJ-1 needs changes; the agent is asked once more\./);
    const sent = pi.sent.length;
    pi.settle();
    assert.equal(pi.sent.length, sent, "no second correction");
    assert.equal(pi.notices.at(-1)?.level, "warning");
    assert.match(
        pi.notices.at(-1)?.text ?? "",
        /^The card for PROJ-1 is not complete: .*Fix .*card\.md by hand, or run \/ticket close PROJ-1 again\.$/,
    );
    assert.deepEqual(jig.tickets, ["PROJ-1"], "the ticket stays active");
    assert.ok(existsSync(draftPath(folder, "PROJ-1")), "the draft stays on disk");
    assert.equal(existsSync(ticketPaths(folder, "PROJ-1").card), false, "no placeholder card is written");
});

test("a card that is too long is named, corrected, and passes once it is shortened", async (t) => {
    const { folder, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR boom", { action: "query" });
    await pi.command("close");
    const paths = ticketPaths(folder, "PROJ-1");
    const front = checkCard(read(draftPath(folder, "PROJ-1"))).front as CardFront;
    writeFileSync(
        draftPath(folder, "PROJ-1"),
        renderCard(front, { ...SECTIONS, Cause: "c".repeat(SECTION_LIMIT + 50) }),
    );
    pi.settle();
    assert.match(
        pi.sent.at(-1)?.message.content ?? "",
        /The section Cause has 450 characters, and the limit is 400: shorten it\./,
    );
    writeFileSync(draftPath(folder, "PROJ-1"), renderCard(front, SECTIONS));
    pi.settle();
    assert.match(pi.notices.at(-1)?.text ?? "", /^Ticket PROJ-1 closed\./);
});

test("a run that was aborted gets a warning and no correction", async (t) => {
    const { pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR boom", { action: "query" });
    await pi.command("close");
    const sent = pi.sent.length;
    pi.settle(true);
    assert.equal(pi.sent.length, sent);
    assert.equal(pi.notices.at(-1)?.level, "warning");
});

test("closing a ticket that is not the active one leaves the active ticket alone", async (t) => {
    const { folder, jig, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR first problem", { action: "query" });
    await pi.command("off");
    pi.input("now PROJ-2");
    await pi.command("close PROJ-1");
    const paths = ticketPaths(folder, "PROJ-1");
    writeFileSync(
        draftPath(folder, "PROJ-1"),
        renderCard(checkCard(read(draftPath(folder, "PROJ-1"))).front as CardFront, SECTIONS),
    );
    pi.settle();
    assert.equal(pi.notices.at(-1)?.text, `Card for PROJ-1 written: ${paths.card}`);
    assert.deepEqual(jig.tickets, ["PROJ-1", undefined, "PROJ-2"], "PROJ-2 is still active");
});

test("a close with nothing to say, no folder, no ticket or a bad key is refused in words", async (t) => {
    const { folder, pi } = start(t);
    await pi.command("close");
    assert.equal(pi.notices.at(-1)?.text, "No active ticket. Run /ticket close KEY.");
    await pi.command("close PROJ-9");
    assert.equal(pi.notices.at(-1)?.text, `No folder for PROJ-9 in ${folder}: run /ticket PROJ-9 first.`);
    await pi.command("close ../x");
    assert.equal(pi.notices.at(-1)?.text, "Use /ticket close, or /ticket close KEY.");
    await pi.command("close PROJ-1 PROJ-2");
    assert.equal(pi.notices.at(-1)?.text, "Use /ticket close, or /ticket close KEY.");
    pi.input("look at PROJ-1");
    const sent = pi.sent.length;
    await pi.command("close");
    assert.equal(
        pi.notices.at(-1)?.text,
        "PROJ-1 has no notes or saved evidence yet, so there is nothing to put on a card.",
    );
    assert.equal(pi.notices.at(-1)?.level, "warning");
    assert.equal(pi.sent.length, sent);
    assert.equal(existsSync(ticketPaths(folder, "PROJ-1").card), false);
});

test("a reopened ticket closes again with a fresh draft", async (t) => {
    const { folder, jig, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR first failure", { action: "query" });
    await pi.command("close");
    const paths = ticketPaths(folder, "PROJ-1");
    writeFileSync(
        draftPath(folder, "PROJ-1"),
        renderCard(checkCard(read(draftPath(folder, "PROJ-1"))).front as CardFront, SECTIONS),
    );
    pi.settle();
    await pi.command("PROJ-1");
    pi.result("logs", "ERROR second failure", { action: "query" });
    await pi.command("close");
    assert.match(read(paths.card), /first failure/);
    assert.equal(
        pi.notices.some((notice) => /A card already exists/.test(notice.text)),
        true,
    );
    assert.deepEqual(jig.tickets, ["PROJ-1", undefined, "PROJ-1"]);
});

test("a tool result without a change, and a settle with no close pending, do nothing", (t) => {
    const { pi } = start(t);
    pi.input("look at PROJ-1");
    assert.equal(changed(pi.result("logs", "ok", { action: "query" })), undefined);
    pi.settle();
    assert.equal(pi.sent.length, 1);
});

test("the ticket close action drafts the card, and an existing card needs update: true", async (t) => {
    const { folder, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "10:00:00 ERROR NullPointerException in OrderMapper", { action: "query" });
    const drafted = await pi.tool({ action: "close" });
    assert.equal(drafted.isError, false, drafted.text);
    assert.match(drafted.text, /Fill its three sections/);
    const paths = ticketPaths(folder, "PROJ-1");
    assert.equal(existsSync(paths.card), false);
    writeFileSync(
        draftPath(folder, "PROJ-1"),
        renderCard(checkCard(read(draftPath(folder, "PROJ-1"))).front as CardFront, SECTIONS),
    );
    pi.settle();
    assert.equal(existsSync(paths.card), true);
    const again = await pi.tool({ action: "close", ticket: "PROJ-1" });
    assert.match(again.text, /already exists.*update: true/);
    const replaced = await pi.tool({ action: "close", ticket: "PROJ-1", update: true });
    assert.match(replaced.text, /Fill its three sections/);
});

test("the last stage offers the close once, and back or a refused advance does not", async (t) => {
    const { pi } = start(t);
    pi.input("look at PROJ-1");
    const message = (ticket: string, last: boolean, to = "done") => ({
        ticket,
        workflow: "feature",
        from: "build",
        to,
        at: new Date().toISOString(),
        last,
        via: "advance" as const,
    });
    const before = pi.sent.length;
    pi.events.emit("jig:stage-done", message("PROJ-1", false, "review"));
    assert.equal(pi.sent.length, before);
    pi.events.emit("jig:stage-done", message("PROJ-1", true));
    assert.equal(pi.sent.length, before + 1);
    assert.match(pi.sent[before]?.message.content ?? "", /reached its workflow.s last stage.*ticket tool.s close/);
    pi.events.emit("jig:stage-done", message("PROJ-1", true));
    assert.equal(pi.sent.length, before + 1, "never repeated");
    const before2 = pi.sent.length;
    pi.events.emit("jig:stage-done", { ...message("PROJ-1", true), last: false });
    assert.equal(pi.sent.length, before2);
});

test("a resumed session knows which tickets were already offered", () => {
    const entries = [
        { type: "custom", customType: "jig-memory-close-offer", data: { ticket: "PROJ-1" } },
        { type: "custom", customType: "jig-memory-close-offer", data: { ticket: "PROJ-2" } },
    ] as never;
    assert.deepEqual([...sessionOffers(entries)].sort(), ["PROJ-1", "PROJ-2"]);
});

test("the close action refuses a path, an absolute path, a symlink and a missing ticket", async (t) => {
    const { folder, pi } = start(t);
    pi.input("look at PROJ-1");
    assert.match((await pi.tool({ action: "close", ticket: ".." })).text, /plain ticket key/);
    assert.match((await pi.tool({ action: "close", ticket: "../elsewhere" })).text, /plain ticket key/);
    assert.match((await pi.tool({ action: "close", ticket: "/tmp/elsewhere" })).text, /plain ticket key/);
    assert.match((await pi.tool({ action: "close", ticket: "MISSING" })).text, /No folder for MISSING/);
    symlinkSync(path.join(folder, "PROJ-1"), path.join(folder, "LINKED"));
    assert.match((await pi.tool({ action: "close", ticket: "LINKED" })).text, /symlinks and files are refused/);
});

test("a malformed stage event does nothing", async (t) => {
    const { pi } = start(t);
    pi.input("look at PROJ-1");
    const before = pi.sent.length;
    pi.events.emit("jig:stage-done", {
        ticket: "../x",
        workflow: "feature",
        from: null,
        to: "done",
        last: true,
        at: "now",
    });
    pi.events.emit("jig:stage-done", {
        ticket: "PROJ-1",
        workflow: "../x",
        from: null,
        to: "done",
        last: true,
        at: new Date().toISOString(),
    });
    assert.equal(pi.sent.length, before);
});

test("an update that is aborted keeps the old card", async (t) => {
    const { folder, pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "10:00:00 ERROR NullPointerException in OrderMapper", { action: "query" });
    const paths = ticketPaths(folder, "PROJ-1");
    const first = await pi.tool({ action: "close" });
    assert.equal(first.isError, false, first.text);
    const front = checkCard(read(draftPath(folder, "PROJ-1"))).front as CardFront;
    const old = renderCard(front, SECTIONS);
    writeFileSync(paths.card, old, { flag: "wx" });
    await pi.tool({ action: "close", update: true });
    pi.settle(true);
    assert.equal(read(paths.card), old);
});

test("a real session_start restores the offered set and does not offer again", (t) => {
    const folder = tempFolder(t);
    ensureTicket(folder, "PROJ-1");
    useJig(t, { memory: { ticketPattern: PATTERN, folder } });
    const pi = loadPlugin("/work", [
        { type: "custom", customType: "jig-memory-ticket", data: { key: "PROJ-1" } },
        { type: "custom", customType: "jig-memory-close-offer", data: { ticket: "PROJ-1" } },
    ] as never);
    pi.start();
    const before = pi.sent.length;
    pi.events.emit("jig:stage-done", {
        ticket: "PROJ-1",
        workflow: "feature",
        from: "build",
        to: "done",
        last: true,
        via: "advance",
        at: new Date().toISOString(),
    });
    assert.equal(pi.sent.length, before);
});

test("a second close while one is pending is refused and changes nothing", async (t) => {
    const { pi } = start(t);
    pi.input("look at PROJ-1");
    pi.result("logs", "ERROR first", { action: "query" });
    const first = await pi.tool({ action: "close" });
    assert.match(first.text, /Fill its three sections/);
    const second = await pi.tool({ action: "close" });
    assert.match(second.text, /A close is already pending/);
    assert.equal(second.isError, false);
});

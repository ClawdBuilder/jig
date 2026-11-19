// The terminal screen of `jig setup`: numbered choices read from a stream and written to one, so a test can see what a
// person sees without a pseudo-terminal.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import { terminalUi } from "../src/cli/terminal.ts";

/** A screen over two streams, and what it printed so far. `keys` makes the streams a terminal: Ctrl+C is then a key.
 *  `interrupt` stands for handing the signal back to the process, which a test must not do to itself. */
function screen(keys = false, interrupt?: () => void) {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (chunk: Buffer) => {
        printed += chunk.toString("utf8");
    });
    // What a terminal's input has that a pipe lacks: raw mode, so a test can see when the keyboard was given back.
    const raw: boolean[] = [];
    (input as unknown as { setRawMode: (mode: boolean) => void }).setRawMode = (mode) => void raw.push(mode);
    const ui = terminalUi({
        input,
        output,
        ...(keys ? { terminal: true } : {}),
        ...(interrupt === undefined ? {} : { interrupt }),
    });
    return { ui, input, printed: () => printed, raw };
}

/** Lets the screen read what was written, so the next question is waiting before the next key arrives. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("the numbered choices of the terminal screen", () => {
    test("ten or more choices keep their names in one column, with the numbers right-aligned", async () => {
        const { ui, input, printed } = screen();
        const names = [
            "Transports",
            "Jira",
            "Logs",
            "Git",
            "Mongo",
            "Api",
            "Ops",
            "Memory",
            "Workflow",
            "Agents",
            "Lens",
        ];
        const asked = ui.select("Which plugin?", [...names, "Done"]);
        input.write("10\n");
        assert.equal(await asked, "Agents");
        ui.close();
        const lines = printed()
            .split("\n")
            .filter((line) => /^\s+\d+\) /.test(line));
        assert.equal(lines.length, 12, printed());
        const columns = new Set(lines.map((line) => line.indexOf(") ")));
        assert.equal(columns.size, 1, `every name starts in the same column:\n${lines.join("\n")}`);
        assert.equal(lines[0], "   1) Transports");
        assert.equal(lines[9], "  10) Agents");
        assert.equal(lines[11], "  12) Done");
    });

    test("fewer than ten choices print as they always did", async () => {
        const { ui, input, printed } = screen();
        const asked = ui.select("Save?", ["Yes", "No", "Cancel"]);
        input.write("2\n");
        assert.equal(await asked, "No");
        ui.close();
        assert.match(printed(), /^Save\?\n {2}1\) Yes\n {2}2\) No\n {2}3\) Cancel\n/);
    });

    test("a number is still read as typed, with or without padding in what is shown", async () => {
        const { ui, input } = screen();
        const options = Array.from({ length: 12 }, (_, index) => `Choice ${index + 1}`);
        const asked = ui.select("Pick", options);
        input.write("3\n");
        assert.equal(await asked, "Choice 3");
        ui.close();
    });
});

describe("Ctrl+C on the terminal screen", () => {
    test("at a choice it is a cancel, not an error, and the screen still asks the next question", async () => {
        const { ui, input } = screen(true);
        const first = ui.select("Which plugin?", ["Jira", "Logs", "Done"]);
        await tick();
        input.write("\x03");
        assert.equal(await first, undefined, "a cancel, as an empty answer is");
        // The screen was not closed by the key: a question asked next still gets its answer.
        const second = ui.confirm("Save the 2 changes you made?", "Yes goes to the review.");
        await tick();
        input.write("y\r");
        assert.equal(await second, true);
        ui.close();
    });

    test("at a yes/no question it is a no", async () => {
        const { ui, input } = screen(true);
        const asked = ui.confirm("Save?", "Writes the file.");
        await tick();
        input.write("\x03");
        assert.equal(await asked, false);
        ui.close();
    });

    test("at a typed answer it is still a cancel", async () => {
        const { ui, input } = screen(true);
        const asked = ui.input("Your Jira address", "https://example.atlassian.net");
        await tick();
        input.write("\x03");
        assert.equal(await asked, undefined);
        ui.close();
    });
});

describe("Ctrl+C on the terminal screen while no question waits", () => {
    // An install or a health check: a wait that is not a question. Raw mode took the keyboard's own signal away, so
    // this key is the only way out the person has, and it must never be kept for a question that comes later.
    test("it gives the terminal back and hands the signal on, once, saying what was not written", async () => {
        const handed: string[] = [];
        const { ui, input, printed, raw } = screen(true, () => handed.push("interrupt"));
        ui.quitSaying("Nothing was written.");
        await tick();
        assert.equal(raw.at(-1), true, "readline holds the keyboard while the screen is open");
        input.write("\x03");
        await tick();
        assert.deepEqual(handed, ["interrupt"]);
        assert.equal(raw.at(-1), false, "the terminal is cooked again before the signal is handed on");
        assert.match(printed(), /\^C\nNothing was written\.\n$/);
    });

    test("it says nothing more than ^C when setup has said nothing to say", async () => {
        const handed: string[] = [];
        const { ui, input, printed } = screen(true, () => handed.push("interrupt"));
        input.write("\x03");
        await tick();
        assert.deepEqual(handed, ["interrupt"]);
        assert.equal(printed(), "^C\n");
        ui.close();
    });

    test("it is not handed on while a question waits: there it is the answer", async () => {
        const handed: string[] = [];
        const { ui, input } = screen(true, () => handed.push("interrupt"));
        ui.quitSaying("Nothing was written.");
        const asked = ui.input("Your Jira address");
        await tick();
        input.write("\x03");
        assert.equal(await asked, undefined);
        assert.deepEqual(handed, []);
        ui.close();
    });

    test("one that arrives between questions ends the run too; it does not cancel the next question", async () => {
        const handed: string[] = [];
        const { ui, input } = screen(true, () => handed.push("interrupt"));
        const first = ui.input("First");
        await tick();
        input.write("one\r");
        assert.equal(await first, "one");
        input.write("\x03");
        await tick();
        assert.deepEqual(handed, ["interrupt"], "the run ends; nothing is kept to cancel what is asked next");
    });
});

describe("a yes/no question on the terminal screen", () => {
    test("is (y/N) by default: Enter is a no, and only y or yes is a yes", async () => {
        for (const [typed, wanted] of [
            ["\n", false],
            ["y\n", true],
            ["YES\n", true],
            ["maybe\n", false],
        ] as const) {
            const { ui, input, printed } = screen();
            const asked = ui.confirm("Save these changes?", "Writes the file.");
            input.write(typed);
            assert.equal(await asked, wanted, JSON.stringify(typed));
            assert.match(printed(), /\(y\/N\) /);
            ui.close();
        }
    });

    test("that is asked with Yes as its default says (Y/n), and Enter is a yes", async () => {
        const { ui, input, printed } = screen();
        const asked = ui.confirm("Save the 3 changes you made?", "Yes goes to the review.", { defaultYes: true });
        input.write("\n");
        assert.equal(await asked, true);
        assert.match(printed(), /\(Y\/n\) /);
        assert.doesNotMatch(printed(), /\(y\/N\)/);
        ui.close();
    });

    test("that is asked with Yes as its default is a no only for n or no, and asks again for any other word", async () => {
        for (const [typed, wanted] of [
            ["y\n", true],
            ["yes\n", true],
            ["n\n", false],
            ["No\n", false],
        ] as const) {
            const { ui, input } = screen();
            const asked = ui.confirm("Save?", "Writes the file.", { defaultYes: true });
            input.write(typed);
            assert.equal(await asked, wanted, JSON.stringify(typed));
            ui.close();
        }
        const { ui, input, printed } = screen();
        const asked = ui.confirm("Save?", "Writes the file.", { defaultYes: true });
        input.write("nope!\n");
        await tick();
        input.write("\n");
        assert.equal(await asked, true, "a word that is neither is not a no: the question is asked again");
        assert.match(printed(), /Type y for yes or n for no\./);
        ui.close();
    });

    test("that is asked with Yes as its default is a no on Ctrl+C: the second Ctrl+C leaves without saving", async () => {
        const { ui, input } = screen(true);
        const asked = ui.confirm("Save the 3 changes you made?", "Yes goes to the review.", { defaultYes: true });
        await tick();
        input.write("\x03");
        assert.equal(await asked, false);
        ui.close();
    });
});

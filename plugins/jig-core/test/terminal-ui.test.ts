// The terminal screen of `jig setup`: numbered choices read from a stream and written to one, so a test can see what a
// person sees without a pseudo-terminal.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import { terminalUi } from "../src/cli/terminal.ts";

/** A screen over two streams, and what it printed so far. */
function screen() {
    const input = new PassThrough();
    const output = new PassThrough();
    let printed = "";
    output.on("data", (chunk: Buffer) => {
        printed += chunk.toString("utf8");
    });
    const ui = terminalUi({ input, output });
    return { ui, input, printed: () => printed };
}

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

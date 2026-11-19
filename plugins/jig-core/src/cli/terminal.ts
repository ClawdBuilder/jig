// A terminal screen for the setup questions: the same four calls Pi's UI offers, on node:readline. Plain numbered choices,
// so nothing has to be installed and arrow keys are not needed; Ctrl+C cancels with exit code 130.
import { createInterface } from "node:readline/promises";
import type { Interface } from "node:readline/promises";
import type { SetupUi } from "../setup.ts";
import { doctorMarkers } from "../doctor.ts";

export interface TerminalScreen extends SetupUi {
    close(): void;
}

/** Where the screen reads and writes: the terminal, unless a test gives it streams. */
export interface TerminalStreams {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
}

export function terminalUi(
    streams: TerminalStreams = { input: process.stdin, output: process.stdout },
): TerminalScreen {
    const say = (text: string): void => {
        streams.output.write(`${text}\n`);
    };
    const rl: Interface = createInterface({ input: streams.input, output: streams.output });
    const ask = async (title: string, placeholder?: string): Promise<string | undefined> => {
        const hint = placeholder === undefined ? "" : ` (${placeholder})`;
        try {
            // An empty answer is the empty answer: the placeholder is an example, not a default. setup.ts knows which
            // values it found on the machine and offers those itself.
            return (await rl.question(`${title}${hint}: `)).trim();
        } catch {
            // Ctrl+C, or the input closed: the only way an answer is missing.
            return undefined;
        }
    };
    return {
        async select(title, options) {
            say(title);
            // The numbers are right-aligned, so the names stay in one column from 10) on.
            const width = String(options.length).length;
            for (const [index, option] of options.entries()) say(`  ${String(index + 1).padStart(width)}) ${option}`);
            for (;;) {
                const answer = (await rl.question("> ")).trim();
                if (answer === "") return undefined;
                const number = Number(answer);
                if (Number.isInteger(number) && number >= 1 && number <= options.length) return options[number - 1];
                const exact = options.find((option) => option.toLowerCase() === answer.toLowerCase());
                if (exact !== undefined) return exact;
                // The first word, when one choice has it: the list of plugins is too long to retype.
                const word = answer.toLowerCase().split(/[\s:]/)[0] ?? "";
                const starts =
                    word === "" ? [] : options.filter((option) => option.toLowerCase().split(/[\s:]/)[0] === word);
                if (starts.length === 1) return starts[0];
                say(`Type a number from 1 to ${options.length}, or the first word of a choice.`);
            }
        },
        async input(title, placeholder) {
            const answer = await ask(title, placeholder);
            return answer;
        },
        async confirm(title, message) {
            say(title);
            say(message);
            const answer = (await rl.question("(y/N) ")).trim().toLowerCase();
            return answer === "y" || answer === "yes";
        },
        notify(text, level) {
            const plain = level === "error" ? "Error: " : level === "warning" ? "Note: " : "";
            const mark = !doctorMarkers(process.env)
                ? plain
                : level === "error"
                  ? "✗ "
                  : level === "warning"
                    ? "! "
                    : "✓ ";
            for (const line of text.split("\n")) say(`${mark}${line}`);
        },
        close() {
            rl.close();
        },
    };
}

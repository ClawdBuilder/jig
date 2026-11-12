// A terminal screen for the setup questions: the same four calls Pi's UI offers, on node:readline. Plain numbered choices,
// so nothing has to be installed and arrow keys are not needed; Ctrl+C cancels with exit code 130.
import { createInterface } from "node:readline/promises";
import type { Interface } from "node:readline/promises";
import type { SetupUi } from "../setup.ts";
import { doctorMarkers } from "../doctor.ts";

export interface TerminalScreen extends SetupUi {
    close(): void;
}

function say(text: string): void {
    process.stdout.write(`${text}\n`);
}

export function terminalUi(): TerminalScreen {
    const rl: Interface = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (title: string, placeholder?: string): Promise<string | undefined> => {
        const hint = placeholder === undefined ? "" : ` (${placeholder})`;
        const answer = (await rl.question(`${title}${hint}: `)).trim();
        return answer === "" && placeholder !== undefined ? placeholder : answer === "" ? undefined : answer;
    };
    return {
        async select(title, options) {
            say(title);
            for (const [index, option] of options.entries()) say(`  ${index + 1}) ${option}`);
            for (;;) {
                const answer = (await rl.question("> ")).trim();
                if (answer === "") return undefined;
                const number = Number(answer);
                if (Number.isInteger(number) && number >= 1 && number <= options.length) return options[number - 1];
                const exact = options.find((option) => option.toLowerCase() === answer.toLowerCase());
                if (exact !== undefined) return exact;
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

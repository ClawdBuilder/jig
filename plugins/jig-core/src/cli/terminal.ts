// A terminal screen for the setup questions: the same four calls Pi's UI offers, on node:readline. Plain numbered choices,
// so nothing has to be installed and arrow keys are not needed. Ctrl+C is an answer, "cancel", at every question: the screen
// stays open, so setup can ask whether to keep what was answered (exit code 130 when it is not). With no question waiting
// (an install, a health check) it is not an answer but the way out: the screen is closed and the signal is handed back.
import { createInterface } from "node:readline/promises";
import type { Interface } from "node:readline/promises";
import type { SetupUi } from "../setup.ts";
import { doctorMarkers } from "../doctor.ts";

export interface TerminalScreen extends SetupUi {
    close(): void;
    /** What to say when Ctrl+C ends the run with no question waiting, such as that nothing was written; none until set. */
    quitSaying(line: string | undefined): void;
}

/** Where the screen reads and writes: the terminal, unless a test gives it streams. `terminal` says the streams are a
 *  terminal, so keys such as Ctrl+C arrive as keys; left out, it is read from the output stream. */
export interface TerminalStreams {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
    terminal?: boolean;
    /** What ends the run when Ctrl+C arrives with no question waiting. The default hands the signal back (see `handBack`);
     *  a test gives its own, because it must not interrupt itself. */
    interrupt?: () => void;
}

/**
 * Gives Ctrl+C back to the terminal's own rule. While the screen is open readline holds the keyboard in raw mode, so the
 * key is not a signal for anyone; closing the screen makes it cooked again, and this sends what the terminal would have
 * sent: SIGINT to the whole foreground group, so a `pi install` that this run started ends with it. Windows has no groups.
 */
function handBack(): void {
    try {
        process.kill(process.platform === "win32" ? process.pid : 0, "SIGINT");
    } catch {
        process.exit(130);
    }
}

export function terminalUi(
    streams: TerminalStreams = { input: process.stdin, output: process.stdout },
): TerminalScreen {
    const say = (text: string): void => {
        streams.output.write(`${text}\n`);
    };
    const rl: Interface = createInterface({
        input: streams.input,
        output: streams.output,
        ...(streams.terminal === undefined ? {} : { terminal: streams.terminal }),
    });
    // Ctrl+C answers the question that waits, as "no answer". Without a listener readline would close itself and reject the
    // question, which ended setup with an error and left nothing for the next question to read from.
    let waiting: AbortController | undefined;
    let quitLine: string | undefined;
    rl.on("SIGINT", () => {
        say("^C");
        if (waiting !== undefined) {
            waiting.abort();
            return;
        }
        // Nothing is asked: setup is installing, or looking at a relay. The key is the way out, never an answer kept for the
        // next question, because the next question may be many seconds away.
        if (quitLine !== undefined) say(quitLine);
        rl.close();
        (streams.interrupt ?? handBack)();
    });
    /** One line, or undefined on Ctrl+C or when the input closed: the only ways an answer is missing. */
    const read = async (prompt: string): Promise<string | undefined> => {
        const controller = new AbortController();
        waiting = controller;
        try {
            return await rl.question(prompt, { signal: controller.signal });
        } catch {
            return undefined;
        } finally {
            waiting = undefined;
        }
    };
    const ask = async (title: string, placeholder?: string): Promise<string | undefined> => {
        const hint = placeholder === undefined ? "" : ` (${placeholder})`;
        // An empty answer is the empty answer: the placeholder is an example, not a default. setup.ts knows which
        // values it found on the machine and offers those itself.
        return (await read(`${title}${hint}: `))?.trim();
    };
    return {
        async select(title, options) {
            say(title);
            // The numbers are right-aligned, so the names stay in one column from 10) on.
            const width = String(options.length).length;
            for (const [index, option] of options.entries()) say(`  ${String(index + 1).padStart(width)}) ${option}`);
            for (;;) {
                const answer = (await read("> "))?.trim();
                if (answer === undefined || answer === "") return undefined;
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
        async confirm(title, message, options) {
            say(title);
            say(message);
            if (options?.defaultYes !== true) {
                const answer = ((await read("(y/N) ")) ?? "").trim().toLowerCase();
                return answer === "y" || answer === "yes";
            }
            // Enter is a yes, so a stray word is not taken for a no: only n, no or Ctrl+C is.
            for (;;) {
                const answer = (await read("(Y/n) "))?.trim().toLowerCase();
                if (answer === undefined || answer === "n" || answer === "no") return false;
                if (answer === "" || answer === "y" || answer === "yes") return true;
                say("Type y for yes or n for no.");
            }
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
        quitSaying(line) {
            quitLine = line;
        },
    };
}

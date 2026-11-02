// The log of a Concourse build, from its event stream. Concourse sends a build's output as server-sent events: text in
// blocks separated by an empty line, each with an `event:` name and `data:` lines. A finished build's stream ends with an
// `end` event. Three kinds say something a person reads:
//
//   log      the output of a step: `payload` is a piece of text, usually a line
//   status   the build's status changed: `status`
//   error    something broke outside any step's output: `message`
//
// Concourse wraps each event in a named `event` block whose data is `{ "event": "log", "data": { ... } }`. The bare form,
// where the block's own name is the kind and its data is the payload, is read too. Everything else (a step starting, a
// resource fetched) is left out. What comes out is text that still needs cleaning and scrubbing (see logs.ts).
import { isObject } from "../values.ts";

interface Frame {
    name: string;
    data: string;
}

/** The blocks of a server-sent text. A comment line, a block with no event name and no data, and `id:` are skipped. */
function frames(body: string): Frame[] {
    return body.split(/\r?\n\r?\n/).flatMap((block) => {
        let name = "";
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
            if (line === "" || line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            const field = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") name = value;
            else if (field === "data") data.push(value);
        }
        return name === "" && data.length === 0 ? [] : [{ name, data: data.join("\n") }];
    });
}

/** The kind and the payload of an event, whichever of the two forms it came in; undefined when it is neither. */
function eventOf(frame: Frame): { kind: string; data: Record<string, unknown> } | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(frame.data);
    } catch {
        return undefined;
    }
    if (!isObject(parsed)) return undefined;
    if (frame.name === "event" || frame.name === "") {
        return typeof parsed.event === "string" && isObject(parsed.data)
            ? { kind: parsed.event, data: parsed.data }
            : undefined;
    }
    return { kind: frame.name, data: parsed };
}

/** The log as plain text: the output of the steps, with a line for each status and error. Stops at `end`. */
export function renderEvents(body: string): string {
    let text = "";
    const line = (content: string) => {
        text += `${text === "" || text.endsWith("\n") ? "" : "\n"}${content}\n`;
    };
    for (const frame of frames(body)) {
        if (frame.name === "end") break;
        const event = eventOf(frame);
        if (event === undefined) continue;
        if (event.kind === "log" && typeof event.data.payload === "string") text += event.data.payload;
        else if (event.kind === "status" && typeof event.data.status === "string")
            line(`[status] ${event.data.status}`);
        else if (event.kind === "error" && typeof event.data.message === "string")
            line(`[error] ${event.data.message}`);
    }
    return text;
}

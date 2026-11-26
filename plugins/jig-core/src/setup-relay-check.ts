// After a session relay is answered, setup asks it once whether it is running: `GET <address>/v1/health`, which the relay
// protocol allows without a token. The token is never sent and never read here; `jig doctor` checks the token and the
// services later. A relay that is not running yet is no refusal: the person may check again, or go on without it. An
// address the section's own rule refuses is neither shown nor sent anywhere: the answer was never accepted.
import { RELAY_PROTOCOL, RelayAnswerError, relayHealth } from "./relay.ts";
import { oneLine, printable } from "./kit/text.ts";
import type { SetupUi } from "./setup.ts";
import type { JigState } from "./engine-state.ts";
import { DEFAULT_RELAY_CLIENT, urlProblem } from "./transports-section.ts";

/** How many of a relay's services the line names; a relay may report thousands. */
const MAX_SERVICES = 10;

/** What one look at the relay's health found: a sentence for the person, whether Jig can use it, and the title of the
 *  choice that follows when it cannot. */
interface Seen {
    text: string;
    usable: boolean;
    title: string;
}

/** Text from the relay or the network, safe on one line: no control character and no format character (a
 *  right-to-left override reorders what follows it). */
function clean(text: string, max = 160): string {
    return oneLine(text.replace(/[\u0000-\u001f\u007f\p{Cf}]/gu, " "), max);
}

/** The sentence for an answer that arrived but is not a healthy relay's: what it was, in words of what happened. */
function answered(url: string, error: RelayAnswerError): Seen {
    const title = "Relay answered with a problem";
    if (error.reason === "refused") {
        const said = error.detail === undefined ? "" : `: ${clean(error.detail).replace(/[.\s]+$/, "")}`;
        const noToken = error.status === 401 || error.status === 403 ? " This check sends no token." : "";
        return {
            text: `The relay answered at ${url} but refused the health check${said} (HTTP ${error.status}).${noToken} Check the relay, or continue without it.`,
            usable: false,
            title,
        };
    }
    const what =
        error.reason === "not-json"
            ? `with HTTP ${error.status}, but not with a relay's JSON (a redirect or a web page?)`
            : "with more than a relay's health answer holds";
    return {
        text: `Something answered at ${url} ${what}. Check the address, or continue without it.`,
        usable: false,
        title,
    };
}

/** One look at the relay's health at `url`; `address` is the same address as it is shown. */
async function look(state: JigState, url: string, address: string): Promise<Seen> {
    try {
        // No token: the config has none and `token` is not asked for, so nothing is read from a secret store.
        const health = await relayHealth(
            "relay",
            { kind: "relay", url, client: DEFAULT_RELAY_CLIENT, services: {}, fields: {} },
            { http: () => state.http },
        );
        if (health.protocol !== RELAY_PROTOCOL) {
            return {
                text:
                    health.protocol === 0
                        ? `Something answered at ${url} with JSON that names no relay protocol. Check the address, or continue without it.`
                        : `Found a relay at ${address} that speaks protocol ${health.protocol}; Jig knows protocol ${RELAY_PROTOCOL}. Use a relay that speaks it.`,
                usable: false,
                title: health.protocol === 0 ? "Relay answered with a problem" : "Relay speaks another protocol",
            };
        }
        const listed = Array.isArray(health.services) ? [] : Object.entries(health.services ?? {});
        const shown = listed
            .slice(0, MAX_SERVICES)
            .map(([name, on]) => `${printable(clean(name, 60))}${on ? "" : " (off)"}`);
        const more = listed.length > MAX_SERVICES ? ` and ${listed.length - MAX_SERVICES} more` : "";
        const named = health.service === "" ? "a relay" : printable(clean(health.service, 60));
        return {
            text: `Found: ${named}, protocol ${RELAY_PROTOCOL}${shown.length === 0 ? "" : `, services: ${shown.join(", ")}${more}`}.`,
            usable: true,
            title: "",
        };
    } catch (error) {
        if (error instanceof RelayAnswerError) return answered(address, error);
        const why = clean(String(error instanceof Error ? error.message : error));
        return {
            text: `Not answering at ${address}: ${why.replace(/[.\s]+$/, "")}. Start it, or continue without it.`,
            usable: false,
            title: "Relay not answering",
        };
    }
}

/**
 * Looks at a new relay's health and says what it found; a relay that does not answer can be checked again or left. An
 * address the section's rule refuses is "refused": nothing is sent and the address is not shown, because it may hold a
 * user name or a password.
 */
export async function checkRelay(state: JigState, ui: SetupUi, url: string): Promise<"ok" | "cancel" | "refused"> {
    const problem = urlProblem(url);
    if (problem !== undefined) {
        ui.notify(`The relay's address was not checked: it ${problem}.`, "warning");
        return "refused";
    }
    const address = clean(url, 120);
    for (;;) {
        ui.notify("Checking the relay…", "info");
        const seen = await look(state, url, address);
        ui.notify(seen.text, seen.usable ? "info" : "warning");
        if (seen.usable) return "ok";
        const next = await ui.select(seen.title, ["Check again", "Continue without it", "Cancel setup"]);
        if (next === "Check again") continue;
        if (next === "Continue without it") return "ok";
        return "cancel";
    }
}

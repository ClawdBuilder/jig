// After a session relay is answered, setup asks it once whether it is running: `GET <address>/v1/health`, which the relay
// protocol allows without a token. The token is never sent and never read here; `jig doctor` checks the token and the
// services later. A relay that is not running yet is no refusal: the person may check again, or go on without it.
import { RELAY_PROTOCOL, relayHealth } from "./relay.ts";
import { oneLine, printable } from "./kit/text.ts";
import type { SetupUi } from "./setup.ts";
import type { JigState } from "./state.ts";
import { DEFAULT_RELAY_CLIENT } from "./transports-section.ts";

/** What one look at the relay's health found: a sentence for the person, and whether it is a relay Jig can use. */
async function look(state: JigState, url: string): Promise<{ text: string; usable: boolean }> {
    try {
        // No token: the config has none and `token` is not asked for, so nothing is read from a secret store.
        const health = await relayHealth(
            "relay",
            { kind: "relay", url, client: DEFAULT_RELAY_CLIENT, services: {}, fields: {} },
            { http: () => state.http },
        );
        if (health.protocol !== RELAY_PROTOCOL) {
            return {
                text: `Found a relay at ${url} that speaks protocol ${health.protocol}; Jig knows protocol ${RELAY_PROTOCOL}. Use a relay that speaks it.`,
                usable: false,
            };
        }
        const services = Object.entries(health.services ?? {}).map(([name, on]) => (on ? name : `${name} (off)`));
        const named = health.service === "" ? "a relay" : printable(health.service);
        return {
            text: `Found: ${named}, protocol ${RELAY_PROTOCOL}${services.length === 0 ? "" : `, services: ${services.map(printable).join(", ")}`}.`,
            usable: true,
        };
    } catch (error) {
        const why = oneLine(
            String(error instanceof Error ? error.message : error).replace(/[\u0000-\u001f\u007f]/g, " "),
            160,
        );
        return {
            text: `Not answering at ${url}: ${why.replace(/[.\s]+$/, "")}. Start it, or continue without it.`,
            usable: false,
        };
    }
}

/** Looks at a new relay's health and says what it found; a relay that does not answer can be checked again or left. */
export async function checkRelay(state: JigState, ui: SetupUi, url: string): Promise<"ok" | "cancel"> {
    for (;;) {
        const seen = await look(state, url);
        ui.notify(seen.text, seen.usable ? "info" : "warning");
        if (seen.usable) return "ok";
        const next = await ui.select("Relay not answering", ["Check again", "Continue without it", "Cancel setup"]);
        if (next === "Check again") continue;
        if (next === "Continue without it") return "ok";
        return "cancel";
    }
}

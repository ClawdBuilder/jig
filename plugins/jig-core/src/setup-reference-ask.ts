// The credential part of one setup question: where a value is kept, the plain parts of that place, and a status that never
// shows a value. A reference is built here and never typed, and nothing is written: the caller decides what an accepted
// reference becomes, so one inside a new object waits until that object's other answers are in.
import { run as runProgram } from "./exec.ts";
import { homedir } from "node:os";
import type { SecretBackend } from "./config.ts";
import { probeSecret } from "./secret-status.ts";
import type { SecretProbe } from "./secret-status.ts";
import { buildReference, describeReference, storeChoiceLabel, storeLabel } from "./setup-reference.ts";
import type { ReferenceParts } from "./setup-reference.ts";
import type { SetupField } from "./setup-plan.ts";
import type { SetupUi } from "./setup.ts";
import type { JigState } from "./state.ts";

/** One candidate place: the reference built for it, and the plain phrase for a summary. Never a value. */
export interface ChosenReference {
    store: SecretBackend;
    reference: string;
    note: string;
}

/** What settling one place did: it is there, the person went on without it, or it needs another try. */
export type ProbeOutcome = "found" | "not-found" | "cancel" | "retry";

/** Chooses a store, asks its plain parts and builds the reference, then hands it to `settle` to check and record. */
export async function chooseReference(
    field: SetupField,
    ui: SetupUi,
    settle: (chosen: ChosenReference) => Promise<"ok" | "cancel" | "retry">,
): Promise<"ok" | "kept" | "cancel"> {
    const choice = field.reference;
    if (choice === undefined || choice.stores.length === 0) {
        ui.notify("No secret store is available for this. /jig doctor names the problem.", "warning");
        return "cancel";
    }
    if (choice.disabled.length > 0) {
        ui.notify(
            `You turned off ${choice.disabled.map(storeLabel).join(", ")}, so ${
                choice.disabled.length === 1 ? "it is" : "they are"
            } not offered.`,
            "info",
        );
    }
    // An empty answer where a place is already set keeps it: setup only asks again so it can change.
    const keep = field.keep === true && typeof field.current === "string" && field.current !== "";
    const labels = [
        ...(keep ? ["Keep the current place"] : []),
        ...choice.stores.map(
            (store) =>
                `${storeChoiceLabel(store)}${choice.preferred === store ? " (company default)" : ""}${
                    choice.current === store ? " (current)" : ""
                }`,
        ),
    ];

    for (;;) {
        const picked = await ui.select(field.question, labels);
        if (picked === undefined || !labels.includes(picked)) return "cancel";
        if (picked === "Keep the current place") {
            ui.notify(`${field.label} kept.`, "info");
            return "kept";
        }
        const store = choice.stores[labels.indexOf(picked) - (keep ? 1 : 0)];
        if (store === undefined) continue;

        if (store === "file") {
            const ok = await ui.confirm(
                "Use a file?",
                "A file is plain text on disk. A password store or 1Password is safer.",
            );
            if (!ok) continue;
        }

        // What the company says to do to add it, shown before the parts are asked, never run.
        const hint = choice.addHints?.[store];
        if (hint !== undefined) ui.notify(`Add it with: ${hint}`, "info");

        // The company's suggestion, when it wrote one for this store: a reference shape, never a value.
        const shape = choice.suggested?.[store];
        if (shape !== undefined) {
            const use = await ui.select(`Use the suggested place in ${storeLabel(store)}?`, [
                `Use ${describeReference(shape)}`,
                "Build it another way",
            ]);
            if (use === undefined) return "cancel";
            if (use.startsWith("Use ")) {
                const settled = await settle({
                    store,
                    reference: shape,
                    note: `read from ${describeReference(shape)} (the suggested place)`,
                });
                if (settled !== "retry") return settled;
            }
        }

        for (;;) {
            const parts = await askParts(store, choice.commands, ui);
            if (parts === undefined) return "cancel";
            const built = buildReference(store, parts, choice.commands);
            if ("problem" in built) {
                ui.notify(built.problem, "warning");
                continue;
            }
            const settled = await settle({ store, reference: built.reference, note: `read from ${built.note}` });
            if (settled !== "retry") return settled;
        }
    }
}

/** Checks one built reference without reading a value: found, missing, locked or not checked, then a retry or a go-on. */
export async function probeChosen(
    state: JigState,
    ui: SetupUi,
    store: SecretBackend,
    reference: string,
): Promise<ProbeOutcome> {
    for (;;) {
        const probe = await probeSecret(reference, probeOptions(state));
        const status = statusText(store, probe);
        ui.notify(status.text, status.level);
        if (probe.status === "found" || probe.status === "unknown") return "found";
        if (probe.status === "invalid") {
            ui.notify("That place cannot be used. Choose another.", "warning");
            return "retry";
        }
        if (probe.fix !== undefined) ui.notify(probe.fix, "info");
        const next = await ui.select("Not found yet", ["Check again", "Continue without it", "Cancel setup"]);
        if (next === "Check again") continue;
        if (next === "Continue without it") return "not-found";
        return "cancel";
    }
}

/** The plain questions for one store. It never asks for a value, and never shows a reference. */
async function askParts(
    store: SecretBackend,
    commands: Readonly<Record<string, readonly string[]>>,
    ui: SetupUi,
): Promise<ReferenceParts | undefined> {
    const ask = async (title: string, placeholder?: string): Promise<string | undefined> => {
        const value = await ui.input(title, placeholder);
        return value === undefined ? undefined : value.trim();
    };
    if (store === "op") {
        const vault = await ask("Which 1Password vault?", "Work");
        if (vault === undefined) return undefined;
        const item = await ask("Which item in that vault?", "example-service");
        if (item === undefined) return undefined;
        const field = await ask("Which field of that item?", "token");
        if (field === undefined) return undefined;
        return { vault, item, field };
    }
    if (store === "keychain") {
        const service = await ask("Which macOS Keychain service?", "example-tool");
        if (service === undefined) return undefined;
        const account = await ask("Which Keychain account?", "jdoe");
        if (account === undefined) return undefined;
        return { service, account };
    }
    if (store === "pass") {
        const entry = await ask("Which entry in your password store?", "work/service-token");
        return entry === undefined ? undefined : { entry };
    }
    if (store === "env") {
        const name = await ask("Which environment variable?", "SERVICE_TOKEN");
        return name === undefined ? undefined : { name };
    }
    if (store === "file") {
        const file = await ask("Which file?", "~/.config/tool/token");
        return file === undefined ? undefined : { file };
    }
    const command = await ui.select("Which command owns that login?", Object.keys(commands));
    return command === undefined ? undefined : { command };
}

/** A found/missing/locked sentence in plain words. It never repeats the reference or a value. */
function statusText(store: SecretBackend, probe: SecretProbe): { text: string; level: "info" | "warning" } {
    const name = storeLabel(store);
    if (probe.status === "found") {
        const extra =
            probe.backend === "op"
                ? " The item is there; the field is not verified."
                : probe.backend === "file"
                  ? " The first line is not read until a tool needs it."
                  : "";
        return {
            text: `Found in ${name}.${extra}${probe.warning === undefined ? "" : ` ${probe.warning}.`}`,
            level: probe.warning === undefined ? "info" : "warning",
        };
    }
    if (probe.status === "missing")
        return { text: `Not in ${name} yet.${probe.fix === undefined ? "" : " Add it with:"}`, level: "warning" };
    if (probe.status === "locked")
        return { text: `Locked: ${probe.detail ?? `the store is locked`}.`, level: "warning" };
    if (probe.status === "invalid") return { text: "That place cannot be used.", level: "warning" };
    return { text: `Not checked: ${probe.detail ?? "Jig cannot check this store."}.`, level: "info" };
}

function probeOptions(state: JigState) {
    return {
        env: state.env,
        passStoreDir: state.secrets.passStoreDir(),
        agentDir: state.agentDir(),
        platform: process.platform,
        home: homedir(),
        run: runProgram,
        cwd: state.workingDir,
    };
}

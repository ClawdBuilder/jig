// What a host gives `createEngine`: what a test (or an embedding program) can replace, where the host keeps its settings, which sections count as
// off, and the two things only Pi has, which are empty elsewhere. They are types only; `engine-state.ts` reads them when it builds the state.
import type { Masker } from "./mask/index.ts";
import type { SecretsOptions } from "./secrets.ts";
import type { Connector } from "./start-checks.ts";
import type { Timers } from "./watch/timers.ts";

/**
 * What a test (or an embedding program) can replace, where the host keeps its settings, which sections of `jig.json` count as off, and the
 * two things only Pi has (its agent folder and the extensions it loaded), which are empty elsewhere. A real Pi session uses the defaults.
 */
export interface EngineOptions {
    /** Makes the masker for a day, with the field names company plugins added. The default masks with the key of
     *  that day. */
    createMasker?: (stateDir: string, now: Date, extraFields: readonly string[]) => Masker;
    now?: () => Date;
    /** The timers the watch engine uses. The default is Node's, none of which keeps the process alive. */
    timers?: Timers;
    /** How long one gate may take before the call it checks is denied. Default 10 seconds. */
    gateTimeoutMs?: number;
    /** Pi's environment, which tells a child agent from the top-level session and where `pass` looks. Default: the process's. */
    env?: NodeJS.ProcessEnv;
    /** How the secret backends start their programs (`pass`, ...). Tests pass a fake. Default: jig-core's own exec. */
    runProgram?: SecretsOptions["run"];
    /** Makes the connection of a start check. Default: a real TCP connection, closed at once. */
    connect?: Connector;
    /** Where jig.json is. The host sets it, because only it knows its settings folder. Default: nowhere, so no file is read. */
    configPath?: () => string;
    /** The sections of jig.json that count as off: kept in the file, not checked, and not a problem, because the plugin that owns
     *  one is not loaded here. Default: the built-in plugins' sections that no loaded plugin registered (`offSectionsOf`). */
    offSections?: ReadonlySet<string>;
    /** Pi only: the agent folder, which holds jig.json and is protected from Pi's file tools. Default: none. */
    agentDir?: () => string;
    /** Pi only: the entry files of the extensions Pi has loaded. Asked when the rules are built, because Pi refuses to say
     *  while extensions are still loading. Default: none. */
    extensionFiles?: () => readonly string[];
    /** Leaves out the update check that `beginSession` starts, and nothing else of it. A host sets it when the notice would reach
     *  nobody (a gateway's goes to standard error) or the registry should not be read. Default: false, so Pi checks as before. */
    skipUpdateCheck?: boolean;
}

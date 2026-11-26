// The `tools` section of jig.json: which Jig tools are deferred. jig-core checks the section like a plugin's (so a company
// plugin can give defaults for it), and at session start says which names are not Jig tools and activates Pi's
// `tool_search`, which finds a deferred tool. The check of the section is `kit/tools-section.ts`, which imports no Pi
// package; the registering itself is `kit/tools.ts`, run by each plugin.
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { hasToolSearch } from "./kit/tools.ts";
import { TOOL_SEARCH, TOOLS_SECTION } from "./kit/tools-section.ts";
import type { JigState, PiState } from "./state.ts";

export { validateToolsSection } from "./kit/tools-section.ts";

/** The names the user (or a company plugin's defaults) asked to defer, as checked. */
export function deferredNames(state: JigState): string[] {
    const section = state.personal.sections.get(TOOLS_SECTION) as { deferred?: unknown } | undefined;
    return Array.isArray(section?.deferred)
        ? section.deferred.filter((name): name is string => typeof name === "string")
        : [];
}

/**
 * At session start: names in `tools.deferred` that no Jig plugin declared are said once, as a warning, and when at least
 * one Jig tool is deferred, `tool_search` is made active (Pi registers it inactive). Without a `tool_search`, the tools
 * stay direct (kit/tools.ts) and the user is told why.
 */
export function settleDeferredTools(state: PiState, ctx: ExtensionContext): void {
    const names = deferredNames(state);
    if (names.length === 0) return;
    const say = (text: string): void => {
        if (ctx.hasUI) ctx.ui.notify(text, "warning");
    };
    const unknown = names.filter((name) => !state.declarations.has(name));
    const key = unknown.join(",");
    if (unknown.length > 0 && state.toolWarnings.unknown !== key) {
        state.toolWarnings.unknown = key;
        say(`jig-core: tools.deferred names no Jig tool: ${unknown.join(", ")} (ignored)`);
    }
    if (names.length === unknown.length) return;
    const { pi } = state;
    if (!hasToolSearch(pi)) {
        if (!state.toolWarnings.noSearch) {
            state.toolWarnings.noSearch = true;
            say(
                `jig-core: tools.deferred is set, but Pi has no ${TOOL_SEARCH} (is builtin:tool-search disabled?), so every Jig tool stays direct`,
            );
        }
        return;
    }
    const active = pi.getActiveTools();
    if (!active.includes(TOOL_SEARCH)) pi.setActiveTools([...active, TOOL_SEARCH]);
}

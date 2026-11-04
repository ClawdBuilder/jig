// What `/jig` and `/jig doctor` say about one registered plugin section. Kept in one place so the two commands cannot
// disagree about whether a section is loaded, waiting for the person, or broken.
import type { LoadedConfig } from "./config.ts";

export type SectionState = "loaded" | "company defaults incomplete" | "not set" | "not set or invalid";

export function sectionState(personal: LoadedConfig, name: string): SectionState {
    if (personal.sections.has(name)) return "loaded";
    if (personal.incomplete.has(name)) return "company defaults incomplete";
    const unreadable = personal.problems.some((problem) => problem.key === "(file)");
    return personal.invalid.has(name) || unreadable ? "not set or invalid" : "not set";
}

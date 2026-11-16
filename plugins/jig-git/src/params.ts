// What a tool with an `action` parameter accepts, written once: for each action its required parameters, its optional
// parameters and a one-line description. The table is the source of the check that refuses a call before it does
// anything (an unknown action, a parameter the action does not use, a missing required one) and of the action list in
// the parameter's description, so the two cannot drift apart.
//
//   const ACTIONS = { commit: { summary: "commit exact paths", required: ["paths", "message"], optional: ["repo"] } };
//   checkParams("git", ACTIONS, params);
//   // git commit needs paths. Usage: git commit {paths, message, repo?}

export type { ActionSpec, ActionTable } from "../../jig-core/src/kit/actions.ts";
export { checkParams, describeActions } from "../../jig-core/src/kit/actions.ts";
import type { ActionTable } from "../../jig-core/src/kit/actions.ts";

/** Every parameter name that any action of the table uses, for a test that compares the table with the schema. */
export function parameterNames(table: ActionTable): Set<string> {
    return new Set(Object.values(table).flatMap((spec) => [...(spec.required ?? []), ...(spec.optional ?? [])]));
}

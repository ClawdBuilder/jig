// Which files of `plugins/jig-core/src` are on Pi's side, and which files reach Pi for now. `engine-boundary.test.ts` reads these
// lists. The reason for the rule: the engine has to load where no Pi package is installed.
//
// A file is an engine file by default: it is on none of the lists. An engine file must not reach a package whose name starts
// with `@earendil-works/` through imports that run (an `import type` does not run), directly or through any file it imports, and
// importing a file of the first list counts as reaching Pi. So a new file is held to the rule until someone lists it here, and
// listing a file here is a decision that shows in review. Paths are relative to `plugins/jig-core/src`.

/**
 * Pi's side: files that register with Pi, draw its screens or call its extension API. They are exempt from the rule, and an
 * engine file that imports one at run time reaches Pi.
 */
export const PI_SIDE_FILES: readonly string[] = [
    "index.ts", // the extension entry: registers Pi's hooks, commands and the watch tool
    "kit/tools.ts", // registers a plugin's tool with Pi (`registerJigTool`) and imports Pi's terminal library
    "approvals.ts", // the question's screens: Pi's selector and review screen (the types and the queue are in ask.ts)
    "state.ts", // Pi's wrapper of the engine's state (`createState`): adds the agent, the screens and Pi's lists (the state is in engine-state.ts)
    "pi-host.ts", // builds the engine's host from Pi's extension API and the context of one event
    "gate.ts", // the `tool_call` hook: turns Pi's event into a request for the engine and its answer into Pi's block result
    "results.ts", // the `tool_result`, `tool_execution_end` and `turn_end` hooks: turn Pi's events into the engine's shapes and back
    "review.ts", // the review screen, drawn with Pi's terminal library
    "commands.ts", // `/jig`, registered with Pi
    "profile-command.ts", // `/profile`, registered with Pi
    "tool-exposure.ts", // Pi's `tool_search` and active tool set
    "watch/tool.ts", // the `watch` tool, registered through `kit/tools.ts`
];

/**
 * Files that reach Pi only because they import `state.ts`, Pi's wrapper (they build or read the state with `createState` or
 * `loadPersonalConfig`). They are exempt from the rule for now. Each must still reach Pi, or the test says to remove it: it is
 * then an engine file. The terminal commands move to the engine in phase 2, and this list is emptied then.
 */
export const REACHES_PI_FOR_NOW: readonly string[] = [
    "cli/headless.ts", // -> state.ts -> approvals.ts -> review.ts -> pi-tui (builds the state with `createState`)
    "cli/main.ts", // -> setup-company.ts -> state.ts -> approvals.ts -> review.ts -> pi-tui
    "setup-company.ts", // -> state.ts -> approvals.ts -> review.ts -> pi-tui (`loadPersonalConfig`)
    "setup-command.ts", // -> state.ts -> approvals.ts -> review.ts -> pi-tui (`loadPersonalConfig`); also `/jig setup` for Pi
];

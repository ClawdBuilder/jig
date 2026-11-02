// The file Pi loads for this plugin. Pi labels an extension by the folder of its entry file, so the entry sits here and the
// label is the plugin's name, not `src`. The code stays in src/, whose index.ts other packages and settings can still load.
export { default } from "./src/index.ts";

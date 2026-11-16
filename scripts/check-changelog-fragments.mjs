// The changelog's fragments: every file in `changelog.d/` must be one a release can fold, or `npm run check` fails and says
// which file and what is wrong. The folder itself is checked, so a missing folder is a failure too.
//   node scripts/check-changelog-fragments.mjs [root]
import path from "node:path";
import { readFragments } from "./changelog-fragments.mjs";

const root = process.argv[2] ?? path.resolve(import.meta.dirname, "..");
const { problems, checked } = readFragments(path.join(root, "changelog.d"));
for (const problem of problems) console.log(`fail ${problem}`);
console.log(`changelog fragments: ${problems.length} failure${problems.length === 1 ? "" : "s"} (${checked} checked)`);
process.exit(problems.length === 0 ? 0 : 1);

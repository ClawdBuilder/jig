// Generates public/theme-boot.js from the one browser implementation. The file runs before the bundle, and the review
// page's CSP allows it as a same-origin script. Run by `npm run build`, so a change to theme-client.ts cannot drift.
import { writeFileSync } from "node:fs";
import { themeBootScript } from "../../../jig-core/src/kit/theme-client.ts";

writeFileSync(
    new URL("../public/theme-boot.js", import.meta.url),
    `/* Generated from jig-core/src/kit/theme-client.ts by scripts/theme-boot.ts. */\n${themeBootScript("system")}\n`,
);

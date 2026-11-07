// The server side of the one palette: the shared CSS, read from the file beside this module. Pages that Node renders
// (jig-core preview, jig-lens) put this CSS in the page; jig-jira's fragment inherits the variables. The review page
// imports theme.css at Vite build time and theme-client.ts for the selector.
import { readFileSync } from "node:fs";
import type { ThemeChoice } from "./theme-client.ts";

export type { ThemeChoice } from "./theme-client.ts";
export {
    resolvedTheme,
    THEME_CHOICES,
    THEME_KEY,
    themeBootScript,
    themeChoice,
    themeControlScript,
} from "./theme-client.ts";

let cached: string | undefined;

/** The shared token CSS, in full. */
export function themeCss(): string {
    cached ??= readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    return cached;
}

/** The html attribute for a configured choice. System leaves it to the media query; light and dark pin it. */
export function themeAttribute(choice: ThemeChoice): string {
    return choice === "system" ? "" : ` data-theme="${choice}"`;
}

// The browser side of the one palette: choose system, light or dark, remember it, and install a small selector. This file
// has no Node imports, so the review page's Vite build can import it directly; the server side is theme.ts.
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "jig-theme";
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

/** A stored or configured value, or system when it is not one of the three. */
export function themeChoice(value: unknown): ThemeChoice {
    return value === "light" || value === "dark" || value === "system" ? value : "system";
}

/** The theme a choice puts on screen now: system asks the system. */
export function resolvedTheme(choice: ThemeChoice, systemDark: boolean): "light" | "dark" {
    return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

/** The inline script that runs before first paint. `defaultChoice` is the jig.json setting (system by default). */
export function themeBootScript(defaultChoice: ThemeChoice = "system"): string {
    return `(function(){try{
var d=${JSON.stringify(themeChoice(defaultChoice))};
try{var s=document.currentScript&&document.currentScript.src;var q=s?new URL(s).searchParams.get("theme"):null;if(q)d=q}catch(e){}
try{window.__JIG_THEME_DEFAULT__=d}catch(e){}
var c="system";try{c=localStorage.getItem("${THEME_KEY}")||d}catch(e){}
if(c!=="light"&&c!=="dark"&&c!=="system")c="system";
var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
var r=c==="system"?(m?"dark":"light"):c;
document.documentElement.dataset.theme=r;
document.documentElement.style.colorScheme=r;
window.__jigThemeChoice=c;
}catch(e){}})();`;
}

/** The selector at the bottom right, and the change handler. It is injected so every page gets the same control. */
export function themeControlScript(): string {
    return `(function(){
function apply(c){var m=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;
var r=c==="system"?(m?"dark":"light"):c;
document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r;
window.__jigThemeChoice=c;try{localStorage.setItem("${THEME_KEY}",c)}catch(e){}}
function add(){if(document.getElementById("jig-theme"))return;
var s=document.createElement("select");s.id="jig-theme";s.setAttribute("aria-label","Theme");
s.innerHTML='<option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>';
s.value=window.__jigThemeChoice||"system";
s.addEventListener("change",function(){apply(s.value)});
document.body.appendChild(s);}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",add);else add();
})();`;
}

/** Run in the page: install the boot choice and the selector. The server-side TypeScript has no DOM lib, so the
 *  browser globals are named once here and used by both the page and the tests' fake. */
interface BrowserGlobal {
    __JIG_THEME_DEFAULT__?: unknown;
    __jigThemeChoice?: ThemeChoice;
    matchMedia?: (query: string) => {
        matches: boolean;
        addEventListener?: (name: string, listener: (event: { matches: boolean }) => void) => void;
    };
    document?: {
        documentElement: { dataset: { theme?: string }; style: { colorScheme?: string } };
        readyState: string;
        getElementById(id: string): unknown;
        createElement(name: string): {
            id: string;
            setAttribute(name: string, value: string): void;
            innerHTML: string;
            value: string;
            addEventListener(name: string, listener: () => void): void;
        };
        addEventListener(name: string, listener: () => void): void;
        body: { appendChild(node: unknown): void };
    };
    localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

export function installTheme(onChange?: (choice: ThemeChoice) => void): void {
    const win = globalThis as unknown as BrowserGlobal;
    const doc = win.document;
    if (doc === undefined) return;
    const root = doc.documentElement;
    let stored: string | null = null;
    try {
        stored = win.localStorage?.getItem(THEME_KEY) ?? null;
    } catch {
        // A browser with storage blocked still gets the system theme.
    }
    const configured = themeChoice(win.__JIG_THEME_DEFAULT__);
    const choice = themeChoice(stored ?? configured);
    const systemDark = win.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    const applied = resolvedTheme(choice, systemDark);
    root.dataset.theme = applied;
    root.style.colorScheme = applied;
    win.__jigThemeChoice = choice;
    const add = () => {
        if (doc.getElementById("jig-theme") !== null) return;
        const select = doc.createElement("select");
        select.id = "jig-theme";
        select.setAttribute("aria-label", "Theme");
        select.innerHTML =
            '<option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>';
        select.value = choice;
        select.addEventListener("change", () => {
            const next = themeChoice(select.value);
            try {
                win.localStorage?.setItem(THEME_KEY, next);
            } catch {
                // The choice lasts this page only when storage is blocked.
            }
            const now = resolvedTheme(next, win.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
            root.dataset.theme = now;
            root.style.colorScheme = now;
            win.__jigThemeChoice = next;
            onChange?.(next);
        });
        doc.body.appendChild(select);
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", add);
    else add();
}

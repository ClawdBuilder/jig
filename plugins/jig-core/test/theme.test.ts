import assert from "node:assert/strict";
import { test } from "node:test";
import { themeAttribute, themeCss, themeChoice, resolvedTheme, themeBootScript } from "../src/kit/theme.ts";

test("a theme choice is one of the three, and the system resolves by the media query", () => {
    assert.equal(themeChoice("dark"), "dark");
    assert.equal(themeChoice("light"), "light");
    assert.equal(themeChoice("system"), "system");
    assert.equal(themeChoice("navy"), "system");
    assert.equal(resolvedTheme("system", true), "dark");
    assert.equal(resolvedTheme("system", false), "light");
    assert.equal(resolvedTheme("light", true), "light");
    assert.equal(resolvedTheme("dark", false), "dark");
});

test("the html attribute pins light or dark, and system leaves it to the media query", () => {
    assert.equal(themeAttribute("system"), "");
    assert.equal(themeAttribute("dark"), ' data-theme="dark"');
    assert.equal(themeAttribute("light"), ' data-theme="light"');
});

test("the one palette defines graphite dark and light, and the boot script carries the configured default", () => {
    const css = themeCss();
    assert.match(css, /--jig-bg: #111113;/);
    assert.match(css, /--jig-bg: #ffffff;/);
    assert.match(css, /--jig-text: #e7e7ea;/);
    assert.match(css, /--jig-muted: #9a9aa2;/);
    assert.match(css, /--jig-add-bg: #14251a;/);
    assert.match(css, /--jig-del-bg: #2a1618;/);
    const script = themeBootScript("dark");
    assert.match(script, /"dark"/);
    assert.match(script, /jig-theme/);
});

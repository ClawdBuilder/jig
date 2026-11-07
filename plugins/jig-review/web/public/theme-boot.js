/* Before first paint: the stored choice, else the server's ui.theme, else the system. CSP allows this file as 'self'. */
(function () {
  try {
    var fromServer = new URLSearchParams(location.search).get("theme");
    window.__JIG_THEME_DEFAULT__ = fromServer;
    var stored = localStorage.getItem("jig-theme");
    var choice = stored || fromServer || "system";
    if (choice !== "light" && choice !== "dark" && choice !== "system") choice = "system";
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var applied = choice === "system" ? (dark ? "dark" : "light") : choice;
    document.documentElement.dataset.theme = applied;
    document.documentElement.style.colorScheme = applied;
  } catch (e) {}
})();

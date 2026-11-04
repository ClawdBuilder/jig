// Plain names for configuration paths, shared by `/jig doctor` and `/jig setup`: "Jira auth token", not
// "jira.auth.token". A person reads these; they are never a raw key from a file.
export function plainLabel(section: string, at: string): string {
    const parts = at
        .split(/[.[\]]+/)
        .filter((part) => part !== "" && !/^\d+$/.test(part))
        .map(humanize);
    const words = [humanize(section), ...parts].filter((word, index, all) => word !== "" && word !== all[index - 1]);
    const label = words.join(" ");
    return label.charAt(0).toUpperCase() + label.slice(1);
}

/** One key or path segment in a person's words: `baseUrl` becomes "base URL", `user_name` becomes "user name". */
export function humanize(word: string): string {
    const spaced = word
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .toLowerCase();
    if (spaced === "url") return "URL";
    if (spaced === "id") return "ID";
    if (spaced === "api") return "API";
    if (spaced === "sso") return "SSO";
    if (spaced === "mcp") return "MCP";
    return spaced;
}

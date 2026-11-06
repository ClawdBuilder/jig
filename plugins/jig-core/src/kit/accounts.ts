// `git.accounts`: which `gh` account a repository's remote is used with. The map is ordered, a key is a remote pattern
// (`github.com:acme/*`), and the first match wins. The pattern is matched against the real remote after ssh aliases are
// resolved, so the same key works for `git@github.com-work:acme/orders-api.git` and for https.
//
// The map is configuration only: a call cannot choose an account, and a matched account never changes the active one.

export type AccountMap = Readonly<Record<string, string>>;

/** A host name: no scheme, port or path, because the key is also shown and put in a `gh` command. */
const HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** A pattern after the host: `owner/name`, with `*` for any characters. */
const PATH = /^[A-Za-z0-9_.*/-]+$/;
/** A `gh` account name. */
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Why a value is not a `git.accounts` map, one message each; empty when it is one. */
export function validateAccounts(value: unknown): string[] {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [
            'git.accounts must map remote patterns to gh account names, such as { "github.com:acme/*": "acme-work" }',
        ];
    }
    const errors: string[] = [];
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 100) errors.push("git.accounts must have at most 100 entries");
    for (const [pattern, account] of entries) {
        const colon = pattern.indexOf(":");
        const host = colon > 0 ? pattern.slice(0, colon) : "";
        const path = colon > 0 ? pattern.slice(colon + 1) : "";
        if (
            colon <= 0 ||
            !HOST.test(host) ||
            host.length > 100 ||
            !PATH.test(path) ||
            !path.includes("/") ||
            path.length > 300
        ) {
            errors.push(
                `git.accounts["${pattern.slice(0, 80)}"] must be a remote pattern of "host:owner/name" or "host:owner/*", such as "github.com:acme/*"`,
            );
            continue;
        }
        if (typeof account !== "string" || !ACCOUNT.test(account)) {
            errors.push(`git.accounts["${pattern.slice(0, 80)}"] must be a gh account name, such as "acme-work"`);
        }
    }
    return errors;
}

/** A remote pattern as a regular expression: `*` matches any characters, and hosts and paths compare without case. */
export function accountPattern(pattern: string): RegExp {
    const colon = pattern.indexOf(":");
    const host = pattern.slice(0, colon).toLowerCase();
    const path = pattern.slice(colon + 1).toLowerCase();
    const quote = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${quote(host)}:${quote(path).replace(/\*/g, ".*")}$`);
}

/**
 * The account a remote (`host:owner/name`, the host real and lower case) is used with, or undefined when no pattern matches.
 * The first match wins, in the order the map is written.
 */
export function accountFor(accounts: AccountMap | undefined, remote: string): string | undefined {
    if (accounts === undefined) return undefined;
    const target = remote.toLowerCase();
    for (const [pattern, account] of Object.entries(accounts)) {
        if (accountPattern(pattern).test(target)) return account;
    }
    return undefined;
}

/** The remote a mapping is matched against: the real host and the repository path. */
export function accountRemote(host: string, owner: string, name: string): string {
    return `${host.toLowerCase()}:${owner.toLowerCase()}/${name.toLowerCase()}`;
}

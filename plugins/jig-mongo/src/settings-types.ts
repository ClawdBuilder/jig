// The shapes of the `mongo` section's settings: a connection to one environment's database, how it is reached, and
// the route a company plugin provides. Re-exported from config.ts, which stays the one import the other files use.

export interface SshRoute {
    kind: "ssh";
    host: string;
    user: string;
    /** A secret reference to the private key. */
    key: string;
    port?: number;
}

/** A tunnel a company plugin provides, by name. */
export interface TunnelRoute {
    kind: "tunnel";
    name: string;
}

export type Route = { kind: "direct" } | SshRoute | TunnelRoute;

export interface HostPort {
    host: string;
    port: number;
}

export interface ParsedUri {
    scheme: "mongodb" | "mongodb+srv";
    hosts: HostPort[];
    /** The path after the hosts: the default database, without the slash. */
    database: string;
    /** The options after the question mark, as written. */
    options: string;
    text: string;
}

export interface Connection {
    environment: string;
    /** The name that picks this connection, when its environment has several. */
    cluster?: string;
    uri: ParsedUri;
    /** Plain text, or a secret reference (see `isReference`). */
    user: string;
    /** A secret reference. */
    password: string;
    authSource?: string;
    tls?: boolean;
    /**
     * Whether a read must use an index (see require-index.ts). Absent: on for production and off for a test environment.
     * Turning it off for production is the user's choice, and `/jig` says so.
     */
    requireIndex?: boolean;
    /** Service name to database name for this connection; only strings, a null in the person's section removes a company entry. */
    services?: ReadonlyMap<string, string>;
    via: Route;
}

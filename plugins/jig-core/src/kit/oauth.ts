// OAuth 2.0 without a browser: jig-core trades a client's credentials (RFC 6749, section 4.4) or an account's name and
// password (section 4.3) for an access token, keeps the token in memory until shortly before it expires, and sends it as
// a Bearer token. A grant that needs a browser (the authorization code, the implicit grant) is not here, and no plugin
// can ask for one.
//
// The token is never written anywhere, never logged and never put in an error. Every failure here is `auth_failed`:
// whether or not the token endpoint got the request, nothing has gone to the API yet.
import type { HttpOAuth, HttpRequest, HttpResponse, HttpValue } from "../contract.ts";
import { HttpError, isHttpError } from "./http-error.ts";
import { isObject } from "./values.ts";

/** A token is replaced this long before it expires, so that it does not run out on the way. */
export const REPLACE_EARLY_MS = 60_000;
/** A command's token has no expiry the endpoint tells us; keep it briefly, and let a 401 run the command again. */
export const COMMAND_TOKEN_MS = 5 * 60_000;
/** The longest a command's token is kept, even when `cacheMs` asks for more. */
export const MAX_COMMAND_TOKEN_MS = 15 * 60_000;
/** A token answer is small. A longer one is not read. */
const MAX_TOKEN_ANSWER_BYTES = 64 * 1024;
/** What a token is: printable characters without a space, so that it can go into a header. */
const TOKEN = /^[\x21-\x7e]{1,8192}$/;
/** The error codes of RFC 6749, section 5.2: the only words of the endpoint's answer that are repeated. */
const OAUTH_ERRORS: ReadonlySet<string> = new Set([
    "invalid_request",
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
]);

export interface Token {
    value: string;
    /** False when the token came from the cache, so it may have expired or been revoked since. */
    fresh: boolean;
    /** Names the cache entry, for `forget`. */
    id: string;
}

/** What a login needs besides the grant. */
export interface Login {
    /** A label that keeps tokens apart. */
    cache: string;
    system: string;
    /** Reads a secret reference. Rejects with an error whose message may be shown. */
    read(reference: string): Promise<string>;
    /** Hides a value from every tool result. */
    redact(value: string): void;
    /** Sends the token request. The clock of the call is the signal. */
    send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse>;
    /** The deadline of the call; the first call starts it. */
    clock(): AbortSignal;
}

export interface Tokens {
    /** The access token for this sign-in: the cached one while it is good, else a new one. */
    get(login: Login, oauth: HttpOAuth): Promise<Token>;
    /** Drops a cached token, such as after a 401. When `value` is given, only that exact token is dropped: a parallel
     *  call that already replaced it is not disturbed. */
    forget(id: string, value?: string): void;
}

interface Cached {
    value: string;
    /** When the token expires, in the clock's milliseconds. Infinity when the endpoint did not say. */
    expiresAt: number;
}

/** The account the grant signs in with, as the secrets gave it. */
interface Account {
    clientId: string;
    clientSecret: string | undefined;
    username: string | undefined;
    password: string | undefined;
}

/** The text in the form of `application/x-www-form-urlencoded`. */
const formEncoded = (value: string): string => new URLSearchParams({ v: value }).toString().slice(2);

/** An error that stands for a sign-in that did not work: `why` is bare, and the plugin words the rest. */
function refused(why: string): HttpError {
    return new HttpError("auth_failed", why, true);
}

/** What the endpoint said was wrong, when it said it in the words of the standard. */
function oauthErrorOf(answer: HttpResponse): string {
    try {
        const data: unknown = JSON.parse(answer.body);
        return isObject(data) && typeof data.error === "string" && OAUTH_ERRORS.has(data.error) ? data.error : "";
    } catch {
        return "";
    }
}

/** How long the token lives, as a time on the clock; Infinity when `expires_in` is missing or not a positive number. */
function expiryOf(data: Record<string, unknown>, now: number): number {
    const given = data.expires_in;
    const seconds = typeof given === "string" && /^\d{1,9}$/.test(given) ? Number(given) : given;
    const valid = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0;
    return valid ? now + seconds * 1000 : Number.POSITIVE_INFINITY;
}

/** The grant, as the form the token endpoint takes. A client with a secret signs in with HTTP Basic unless the sign-in
 *  says to put it in the form. */
function tokenRequest(login: Login, oauth: HttpOAuth, account: Account): HttpRequest {
    const form = new URLSearchParams({ grant_type: oauth.grant });
    if (oauth.grant === "password") {
        form.set("username", account.username ?? "");
        form.set("password", account.password ?? "");
    }
    form.set("client_id", account.clientId);
    if (oauth.scope !== undefined) form.set("scope", oauth.scope);
    const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "jig-core",
    };
    if (account.clientSecret !== undefined) {
        if (oauth.clientAuth === "body") {
            form.set("client_secret", account.clientSecret);
        } else {
            // RFC 6749, section 2.3.1: the client's id and secret are form-encoded before they are joined.
            const pair = `${formEncoded(account.clientId)}:${formEncoded(account.clientSecret)}`;
            headers.Authorization = `Basic ${Buffer.from(pair).toString("base64")}`;
        }
    }
    return {
        system: login.system,
        method: "POST",
        url: oauth.tokenUrl ?? "",
        headers,
        body: form.toString(),
        maxBytes: MAX_TOKEN_ANSWER_BYTES,
    };
}

/** The token in the endpoint's answer, or an error that says what was wrong with the answer. */
function tokenFrom(answer: HttpResponse, now: number): { value: string; expiresAt: number } {
    if (answer.status !== 200) {
        const code = oauthErrorOf(answer);
        throw refused(`the token endpoint answered HTTP ${answer.status}${code === "" ? "" : `, ${code}`}`);
    }
    let data: unknown;
    try {
        data = answer.truncated ? undefined : JSON.parse(answer.body);
    } catch {
        data = undefined;
    }
    const token = isObject(data) ? data.access_token : undefined;
    if (!isObject(data) || typeof token !== "string" || !TOKEN.test(token)) {
        throw refused("the token endpoint answered without a usable access_token");
    }
    if (data.token_type !== undefined && String(data.token_type).toLowerCase() !== "bearer") {
        // The endpoint's own word for the type is not repeated: it is text from outside.
        throw refused(
            "the token endpoint answered with a token that is not a bearer token, and only bearer tokens are sent",
        );
    }
    return { value: token, expiresAt: expiryOf(data, now) };
}

/** What the sign-in settings say, checked before anything is read or sent. Throws an error with a bare reason. */
function checkSettings(oauth: HttpOAuth): void {
    if (!isObject(oauth)) throw refused("auth.oauth must be an object");
    if (!["client_credentials", "password", "command"].includes(oauth.grant)) {
        throw refused("auth.oauth.grant must be client_credentials, password or command");
    }
    const value = (item: HttpValue | undefined): boolean =>
        item === undefined || typeof item === "string" || (isObject(item) && typeof item.ref === "string");
    if (oauth.grant === "command") {
        if (typeof oauth.command !== "string" || oauth.command === "") {
            throw refused("auth.oauth.command must be a secret reference");
        }
        if (oauth.cacheMs !== undefined && (!Number.isFinite(oauth.cacheMs) || oauth.cacheMs < 0)) {
            throw refused("auth.oauth.cacheMs must be a non-negative number of milliseconds");
        }
        return;
    }
    if (typeof oauth.tokenUrl !== "string" || !/^https?:\/\//i.test(oauth.tokenUrl)) {
        throw refused("auth.oauth.tokenUrl must be an http or https address");
    }
    if (!value(oauth.clientId) || oauth.clientId === undefined) throw refused("auth.oauth.clientId is needed");
    for (const name of ["clientSecret", "username", "password"] as const) {
        if (!value(oauth[name])) throw refused(`auth.oauth.${name} must be text or a { ref }`);
    }
}

export function createTokens(now: () => number): Tokens {
    const cache = new Map<string, Cached>();

    /** Reads the account's secrets, with no deadline: a store may wait for the user to unlock it, and that is not the
     *  API's time. */
    async function accountOf(oauth: HttpOAuth, login: Login): Promise<Account> {
        const read = (item: HttpValue | undefined): Promise<string | undefined> => {
            if (item === undefined) return Promise.resolve(undefined);
            return typeof item === "string" ? Promise.resolve(item) : login.read(item.ref);
        };
        const [clientId, clientSecret, username, password] = await Promise.all([
            read(oauth.clientId),
            read(oauth.clientSecret),
            read(oauth.username),
            read(oauth.password),
        ]);
        return { clientId: clientId ?? "", clientSecret, username, password };
    }

    /** Asks the token endpoint for a token. */
    async function request(login: Login, oauth: HttpOAuth): Promise<{ value: string; expiresAt: number }> {
        const account = await accountOf(oauth, login);
        let answer: HttpResponse;
        try {
            answer = await login.send(tokenRequest(login, oauth, account), login.clock());
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // A request that may have reached the endpoint says so; one that never left says why it did not.
            throw refused(
                isHttpError(error) && !error.notSent ? `the token request got no answer: ${message}` : message,
            );
        }
        const token = tokenFrom(answer, now());
        login.redact(token.value);
        return token;
    }

    const pending = new Map<string, Promise<Token>>();

    return {
        async get(login, oauth) {
            checkSettings(oauth);
            // The key holds the references of the secrets and never their values.
            const id = JSON.stringify([
                login.cache,
                oauth.grant,
                oauth.tokenUrl,
                oauth.command,
                oauth.cacheMs,
                oauth.clientId,
                oauth.clientSecret,
                oauth.username,
                oauth.password,
                oauth.scope,
                oauth.clientAuth,
            ]);
            const kept = cache.get(id);
            // The early replacement margin protects a token with a server-provided expiry. A command's token has none:
            // use exactly the requested lifetime, so 0 means every call runs the command and 30 s lasts 30 s.
            const early = oauth.grant === "command" ? 0 : REPLACE_EARLY_MS;
            if (kept !== undefined && now() < kept.expiresAt - early) {
                return { value: kept.value, fresh: false, id };
            }
            const running = pending.get(id);
            if (running !== undefined) return running;
            const work = (async (): Promise<Token> => {
                let made: { value: string; expiresAt: number };
                let fresh = true;
                if (oauth.grant === "command") {
                    const value = await login.read(oauth.command as string);
                    if (!TOKEN.test(value)) throw refused("the token command did not print a usable bearer token");
                    login.redact(value);
                    const lifetime = Math.min(oauth.cacheMs ?? COMMAND_TOKEN_MS, MAX_COMMAND_TOKEN_MS);
                    made = { value, expiresAt: now() + lifetime };
                    // A command's token carries no expiry the endpoint told us about, so a 401 is the only signal that
                    // it was stale: let the one 401 resend run the command again, even on the first use.
                    fresh = false;
                } else {
                    made = await request(login, oauth);
                }
                cache.set(id, made);
                return { value: made.value, fresh, id };
            })();
            pending.set(id, work);
            try {
                return await work;
            } finally {
                pending.delete(id);
            }
        },

        forget(id, value) {
            if (value === undefined || cache.get(id)?.value === value) cache.delete(id);
        },
    };
}

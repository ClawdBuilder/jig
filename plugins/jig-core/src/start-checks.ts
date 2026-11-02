// Start checks: the `startChecks` list of `jig.json`, and the test it names. A check is one TCP connection to a host and a
// port, made when a session starts, so a user who forgot to connect their VPN hears of it before a tool fails at it.
//
// It is the user's list and no one else's: `startChecks` is a section of jig-core's own, so a company plugin cannot add a
// host for a user's machine to probe. This file holds what the list is (its checking, here); running it comes below.
import { isIP, isIPv4, isIPv6 } from "node:net";
import { printable } from "./kit/text.ts";
import { isObject } from "./kit/values.ts";

/** One check, as `jig.json` writes it, with the address split. `tcp` is kept as written, for messages. */
export interface StartCheck {
    name: string;
    tcp: string;
    host: string;
    port: number;
    hint?: string;
}

/** The most checks a list holds. Each is one connection, all made at once when a session starts. */
export const MAX_START_CHECKS = 16;
const MAX_NAME_CHARS = 40;
const MAX_HINT_CHARS = 200;
const MAX_TCP_CHARS = 270;
const FIELDS = ["name", "tcp", "hint"];

type Fail = (key: string, message: string) => void;

/** Letters, digits and hyphens in dot-separated labels, none longer than 63 characters or starting or ending with a hyphen. */
const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** Control and format characters (a bidi override included) and line separators: nothing a notice should show. */
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function isHostname(host: string): boolean {
    return host.length <= 253 && host.split(".").every((label) => HOST_LABEL.test(label));
}

/** `host:port` (`[::1]:443` for an IPv6 address) as a host and a port, or undefined when it is not one. */
export function splitTcp(text: string): { host: string; port: number } | undefined {
    if (text.length > MAX_TCP_CHARS) return undefined;
    const colon = text.lastIndexOf(":");
    if (colon < 0) return undefined;
    const portText = text.slice(colon + 1);
    if (!/^[1-9][0-9]{0,4}$/.test(portText) || Number(portText) > 65535) return undefined;
    const written = text.slice(0, colon);
    const bracketed = written.startsWith("[") && written.endsWith("]");
    const host = bracketed ? written.slice(1, -1) : written;
    const fine = bracketed ? isIPv6(host) : isIPv4(host) || (isIP(host) === 0 && isHostname(host));
    return fine ? { host, port: Number(portText) } : undefined;
}

/** A text of `1..max` characters that holds nothing unprintable and is not only spaces. */
function isPrintableText(value: unknown, max: number): value is string {
    return typeof value === "string" && value.trim() !== "" && [...value].length <= max && !UNPRINTABLE.test(value);
}

function parseOne(item: unknown, here: string, fail: Fail): StartCheck | undefined {
    if (!isObject(item)) {
        fail(here, "must be an object with name, tcp and an optional hint");
        return undefined;
    }
    let valid = true;
    const bad: Fail = (key, message) => {
        valid = false;
        fail(key, message);
    };
    for (const key of Object.keys(item))
        if (!FIELDS.includes(key)) bad(`${here}.${printable(key)}`, "is not a known field");
    const { name, tcp, hint } = item;
    if (name === undefined) bad(`${here}.name`, "is required");
    else if (!isPrintableText(name, MAX_NAME_CHARS))
        bad(`${here}.name`, `must be 1 to ${MAX_NAME_CHARS} printable characters`);
    const address = typeof tcp === "string" ? splitTcp(tcp) : undefined;
    if (tcp === undefined) bad(`${here}.tcp`, "is required");
    else if (address === undefined) {
        bad(
            `${here}.tcp`,
            "must be host:port: a hostname or IP address, a colon and a port from 1 to 65535 ([::1]:443 for IPv6)",
        );
    }
    if (hint !== undefined && !isPrintableText(hint, MAX_HINT_CHARS))
        bad(`${here}.hint`, `must be 1 to ${MAX_HINT_CHARS} printable characters`);
    if (!valid || typeof name !== "string" || typeof tcp !== "string" || address === undefined) return undefined;
    return { name, tcp, ...address, ...(typeof hint === "string" ? { hint } : {}) };
}

/** `[{ name, tcp, hint? }, ...]`: at most 16 checks. A message names the key and never repeats a value. */
export function parseStartChecks(raw: unknown, path: string, fail: Fail): StartCheck[] {
    if (!Array.isArray(raw)) {
        fail(path, "must be a list of checks, each with a name, a tcp address and an optional hint");
        return [];
    }
    if (raw.length > MAX_START_CHECKS) {
        fail(path, `must hold at most ${MAX_START_CHECKS} checks`);
        return [];
    }
    const checks: StartCheck[] = [];
    raw.forEach((item, index) => {
        const check = parseOne(item, `${path}[${index}]`, fail);
        if (check !== undefined) checks.push(check);
    });
    return checks;
}

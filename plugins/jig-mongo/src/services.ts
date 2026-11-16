// A connection's `services`: the service name a call gives, and the database name that environment uses for it. A null
// value is the person's way to leave out a company default; it is dropped here, never written.
import { DATABASE_NAME } from "./access.ts";
import { isObject, shown } from "./values.ts";

const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_SERVICES = 100;

/** The services a connection maps, or undefined when it maps none. */
export function checkServices(raw: unknown, at: string, errors: string[]): Map<string, string> | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object mapping a service name to a database name, or null to leave one out`);
        return undefined;
    }
    const entries = Object.entries(raw);
    if (entries.length > MAX_SERVICES) errors.push(`${at}: must name at most ${MAX_SERVICES} services`);
    const services = new Map<string, string>();
    for (const [name, value] of entries) {
        if (!SERVICE_NAME.test(name)) {
            errors.push(`${at}.${shown(name, 30)}: a service name uses letters, digits, . _ and -`);
            continue;
        }
        if (value === null) continue;
        if (typeof value !== "string" || !DATABASE_NAME.test(value)) {
            errors.push(`${at}.${shown(name, 30)}: must be a database name or null`);
            continue;
        }
        services.set(name, value);
    }
    return services;
}

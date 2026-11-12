// The errors a request throws and a transport may refuse with. See http.ts.
import type { TransportRefusalInfo } from "../contract.ts";

/** Why a request got no reply (see `HttpErrorInfo` in the contract). */
export class HttpError extends Error {
    readonly code: string;
    /** True when the request cannot have changed anything at the far end: it was never sent, or a transport refused it
     *  and promises that nothing changed. False when it may have changed something. */
    readonly notSent: boolean;
    /** For `transport_refused`: the refusal's own code, kept for the record. */
    readonly transportCode?: string;
    /** For `transport_refused`: the transport's request id, to match its own log line. */
    readonly requestId?: string;
    constructor(
        code: string,
        message: string,
        notSent: boolean,
        cause?: unknown,
        transportCode?: string,
        requestId?: string,
    ) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = "HttpError";
        this.code = code;
        this.notSent = notSent;
        this.transportCode = transportCode;
        this.requestId = requestId;
    }
}

/** True for an `HttpError` from any copy of this module: a plugin in its own package root has its own. */
export function isHttpError(error: unknown): error is HttpError {
    return (
        error instanceof Error &&
        error.name === "HttpError" &&
        typeof (error as { code?: unknown }).code === "string" &&
        typeof (error as { notSent?: unknown }).notSent === "boolean"
    );
}

/**
 * A transport's own refusal: a small, structural error a company transport may throw. `notSent: true` means the far end
 * was not changed by this request, so sending it again cannot repeat a change; it does not mean nothing left the
 * transport. Any error that is not a valid refusal keeps the plain `transport_failed` handling.
 */
export class TransportRefusal extends Error implements TransportRefusalInfo {
    readonly name = "TransportRefusal" as const;
    readonly code: string;
    /** True: the far end was not changed, so a retry cannot repeat a change. */
    readonly notSent: boolean;
    /** A short id from the transport's own log. */
    readonly requestId?: string;
    constructor(code: string, message: string, notSent: boolean, requestId?: string) {
        super(message);
        this.code = code;
        this.notSent = notSent;
        this.requestId = requestId;
    }
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** A structural check, like `isHttpError`: a company transport has its own copy of the kit. */
export function isTransportRefusal(error: unknown): error is TransportRefusal {
    if (!(error instanceof Error) || error.name !== "TransportRefusal") return false;
    const candidate = error as { code?: unknown; notSent?: unknown; requestId?: unknown; message?: unknown };
    return (
        typeof candidate.code === "string" &&
        CODE.test(candidate.code) &&
        typeof candidate.notSent === "boolean" &&
        typeof candidate.message === "string" &&
        (candidate.requestId === undefined ||
            (typeof candidate.requestId === "string" && REQUEST_ID.test(candidate.requestId)))
    );
}

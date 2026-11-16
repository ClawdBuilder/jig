// Where the sandbox runtime puts its own sockets. It names them `srt-mux-<pid>-<sequence>.sock` in `TMPDIR`, and a Unix
// socket path has to fit in `sun_path`: 104 bytes on macOS, 108 on Linux, the last byte the NUL. macOS puts temporary
// folders under `/private/var/folders/...`, so this session's own `tmp` is often too long there, and the runtime fails to
// listen with EINVAL before bash ever runs.
import path from "node:path";

/** The longest socket path that fits: `sun_path`'s size less the byte for the NUL. */
export function socketPathLimit(platform: NodeJS.Platform = process.platform): number {
    return (platform === "darwin" ? 104 : 108) - 1;
}

/** The runtime's socket for one pid, with the sequence at its longest (six base-36 digits). */
export function runtimeSocketPath(folder: string, pid: number): string {
    return path.join(folder, `srt-mux-${pid}-zzzzzz.sock`);
}

export interface RuntimeTmpOptions {
    platform?: NodeJS.Platform;
    pid?: number;
    /** The short folder to fall back to, `/tmp` unless a test names another. */
    fallback?: string;
}

/**
 * The folder the runtime should put its sockets in: the session's own `tmp` when its socket path fits, else the fallback,
 * `/tmp`. Throws when even that cannot fit, naming the path and the limit, because a runtime that cannot listen means
 * bash cannot run.
 */
export function runtimeTmpDir(preferred: string, options: RuntimeTmpOptions = {}): string {
    const platform = options.platform ?? process.platform;
    const pid = options.pid ?? process.pid;
    const fallback = options.fallback ?? "/tmp";
    const limit = socketPathLimit(platform);
    const fits = (folder: string): boolean => runtimeSocketPath(folder, pid).length <= limit;
    if (fits(preferred)) return preferred;
    if (fits(fallback)) return fallback;
    throw new Error(
        `the sandbox cannot start: a socket path would be longer than ${limit} bytes (${runtimeSocketPath(fallback, pid)}); set TMPDIR to a shorter folder`,
    );
}

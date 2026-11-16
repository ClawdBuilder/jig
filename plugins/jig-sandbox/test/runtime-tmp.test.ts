// Where the sandbox runtime puts its sockets: the session's tmp when a socket path fits in sun_path, /tmp when it does
// not (macOS's temporary folders are deep), and a clear error when nothing fits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeSocketPath, runtimeTmpDir, socketPathLimit } from "../src/runtime-tmp.ts";

// The path the macOS run failed on: /private/var/folders/... is 84 characters before the socket's name.
const MACOS_SESSION = "/private/var/folders/h5/t85nd63d71x27_8gl5gw3l_w0000gn/T/jig-sandbox-501/01a1e388-zMSAnI";

test("the limit is sun_path less the NUL: 103 on macOS, 107 on Linux", () => {
    assert.equal(socketPathLimit("darwin"), 103);
    assert.equal(socketPathLimit("linux"), 107);
});

test("a session folder whose socket path fits is kept", () => {
    assert.equal(
        runtimeTmpDir("/tmp/jig-sandbox-501/ab12cd34-x", { platform: "linux", pid: 37920 }),
        "/tmp/jig-sandbox-501/ab12cd34-x",
    );
    assert.equal(runtimeTmpDir(`${MACOS_SESSION}/tmp`, { platform: "darwin", pid: 37805, fallback: "/tmp" }), "/tmp");
});

test("a socket path one byte over the limit falls back, one at the limit does not", () => {
    const pid = 37805;
    // A folder whose socket path is exactly the limit on macOS, and the same folder one character longer.
    const suffix = "/srt-mux-37805-zzzzzz.sock";
    const room = socketPathLimit("darwin") - suffix.length;
    const exact = `/${"a".repeat(room - 1)}`;
    assert.equal(runtimeTmpDir(exact, { platform: "darwin", pid }), exact);
    assert.equal(runtimeTmpDir(`${exact}a`, { platform: "darwin", pid }), "/tmp");
    assert.ok(runtimeSocketPath(exact, pid).length <= socketPathLimit("darwin"));
});

test("when even the fallback cannot fit, the error names the path and the limit", () => {
    const long = `/${"a".repeat(socketPathLimit("linux"))}`;
    assert.throws(
        () => runtimeTmpDir(long, { platform: "linux", pid: 1, fallback: long }),
        (error: Error) => {
            assert.match(error.message, /the sandbox cannot start/);
            assert.match(error.message, new RegExp(`longer than ${socketPathLimit("linux")} bytes`));
            assert.match(error.message, /set TMPDIR to a shorter folder/);
            return true;
        },
    );
});

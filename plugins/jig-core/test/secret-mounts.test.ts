// Whether a file is on a Windows drive seen from WSL, from the mount table the kernel keeps (/proc/mounts) or, when that
// table is not there, from the /mnt/<letter>/ prefix on a WSL kernel. A drive's files always look world-readable from
// Linux, and chmod changes nothing there, so the secret probe must not warn about them.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { windowsDrive } from "../src/secret-mounts.ts";

const WSL2 = "6.6.36.3-microsoft-standard-WSL2";
const NATIVE = "6.8.0-45-generic";

/** What `/proc/mounts` holds on WSL 2: the C: drive is a 9p mount with aname=drvfs, and the drivers folder is a 9p mount too. */
const WSL2_TABLE = [
    "/dev/sdc / ext4 rw,relatime,discard 0 0",
    "drivers /usr/lib/wsl/drivers 9p ro,nosuid,nodev,noatime,aname=drivers;fmask=222;dmask=222,cache=0x5 0 0",
    "C:\\134 /mnt/c 9p rw,noatime,aname=drvfs;path=C:\\;uid=1000;gid=1000;symlinkroot=/mnt/,cache=0x5 0 0",
    "/dev/sdd /mnt/data ext4 rw,relatime 0 0",
    "",
].join("\n");

/** WSL 1 names the file system itself. */
const WSL1_TABLE = "rootfs / lxfs rw 0 0\nC: /mnt/c drvfs rw,noatime,uid=1000 0 0\n";

describe("a file on a Windows drive", () => {
    test("is found from the mount table: a 9p mount with aname=drvfs (WSL 2) or a drvfs mount (WSL 1)", () => {
        const where = "/mnt/c/Users/jdoe/AppData/Local/relay/token";
        assert.equal(windowsDrive(where, { mounts: WSL2_TABLE, release: WSL2 }), "mount table");
        assert.equal(windowsDrive(where, { mounts: WSL1_TABLE, release: WSL2 }), "mount table");
    });

    test("is not mistaken for another 9p mount, or for a Linux mount under /mnt", () => {
        assert.equal(windowsDrive("/usr/lib/wsl/drivers/x", { mounts: WSL2_TABLE, release: WSL2 }), undefined);
        assert.equal(windowsDrive("/mnt/data/token", { mounts: WSL2_TABLE, release: WSL2 }), undefined);
        assert.equal(windowsDrive("/home/jdoe/.config/relay/token", { mounts: WSL2_TABLE, release: WSL2 }), undefined);
    });

    test("is found by the longest mount that holds the path, so a Linux mount inside a drive is not one", () => {
        const table = `${WSL2_TABLE}/dev/sde /mnt/c/linux-in-c ext4 rw 0 0\n`;
        assert.equal(windowsDrive("/mnt/c/linux-in-c/token", { mounts: table, release: WSL2 }), undefined);
        assert.equal(windowsDrive("/mnt/c/other/token", { mounts: table, release: WSL2 }), "mount table");
    });

    test("is found when the mount point holds a space or a backslash, as the kernel writes it in octal", () => {
        const table = "D:\\134 /mnt/my\\040drive 9p rw,aname=drvfs;path=D:\\;uid=1000 0 0\n";
        assert.equal(windowsDrive("/mnt/my drive/token", { mounts: table, release: WSL2 }), "mount table");
    });

    test("is found by the /mnt/<letter>/ prefix on a WSL kernel when there is no mount table", () => {
        assert.equal(windowsDrive("/mnt/c/Users/jdoe/token", { mounts: "", release: WSL2 }), "path prefix");
        assert.equal(windowsDrive("/mnt/d/token", { mounts: "", release: WSL2 }), "path prefix");
    });

    test("is not guessed from the prefix off WSL, or from a longer name under /mnt", () => {
        assert.equal(windowsDrive("/mnt/c/token", { mounts: "", release: NATIVE }), undefined);
        assert.equal(windowsDrive("/mnt/cdrom/token", { mounts: "", release: WSL2 }), undefined);
        assert.equal(
            windowsDrive("/mnt/c", { mounts: "", release: WSL2 }),
            undefined,
            "a folder, not a file in a drive",
        );
    });

    test("a table that does not list the path leaves the prefix out of it: the table is the answer", () => {
        assert.equal(
            windowsDrive("/mnt/c/token", { mounts: WSL2_TABLE.replace(/C:.*\n/, ""), release: WSL2 }),
            undefined,
        );
    });
});

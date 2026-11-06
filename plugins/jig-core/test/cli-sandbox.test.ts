// The command's sandbox check: the programs the sandbox needs, a real namespace start on Linux, and the install command
// for the system in front of the person. macOS has the sandbox built in.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { distroOf, installCommand } from "../src/kit/sandbox-programs.ts";
import { sandboxChecks } from "../src/doctor-tools.ts";
import type { DoctorContext, DoctorOptions } from "../src/doctor.ts";

const context = (path: string): DoctorContext =>
    ({
        env: { PATH: path },
        sections: new Map(),
        sandbox: { active: false, note: "not started" },
        standalone: true,
    }) as unknown as DoctorContext;

describe("the sandbox on this machine", () => {
    test("names the install command for the system", () => {
        assert.equal(distroOf("ID=ubuntu\nID_LIKE=debian\n"), "apt");
        assert.equal(distroOf("ID=fedora\n"), "dnf");
        assert.equal(distroOf('NAME="Rocky Linux"\nID="rocky"\n'), "dnf");
        assert.equal(distroOf("ID=arch\n"), "pacman");
        assert.equal(distroOf('ID="opensuse-tumbleweed"\n'), "zypper");
        assert.match(
            installCommand("linux", [{ name: "bwrap" }, { name: "socat" }], "dnf"),
            /sudo dnf install bubblewrap socat/,
        );
        assert.equal(installCommand("darwin", [{ name: "bwrap" }]), "the sandbox is part of macOS; nothing to install");
    });

    test("missing programs are a failure with the exact command, not a skip", async () => {
        const lines = await sandboxChecks(context("/nonexistent"), {
            platform: "linux",
            run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
        });
        const failures = lines.filter((line) => line.level === "fail");
        assert.equal(failures.length, 3);
        assert.match(failures[0]?.detail ?? "", /bubblewrap|bwrap/);
        assert.match(failures[0]?.fix ?? "", /^sudo (apt|dnf|pacman|zypper) install /);
        assert.match(failures.map((line) => line.fix).join("\n"), /bubblewrap/);
    });

    test("a real namespace start is checked", async () => {
        const lines = await sandboxChecks(context("/usr/bin"), {
            platform: "linux",
            run: async () => ({
                code: 1,
                stdout: "",
                stderr: "bwrap: setting up uid map: Permission denied",
                timedOut: false,
            }),
        });
        const start = lines.find((line) => line.id === "sandbox.start");
        assert.equal(start?.level, "fail");
        assert.match(start?.fix ?? "", /sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0/);
    });

    test("macOS says there is nothing to install", async () => {
        const lines = await sandboxChecks(context("/usr/bin"), { platform: "darwin" });
        assert.equal(lines.length, 1);
        assert.equal(lines[0]?.level, "ok");
        assert.match(lines[0]?.detail ?? "", /nothing to install/);
    });
});

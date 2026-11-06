// Re-exported from jig-core's kit: the command's doctor and the sandbox must read the same paths and the same install
// command, and the kit is what a plugin may share.
export {
    APPARMOR_SYSCTL,
    distroOf,
    findPrograms,
    installCommand,
    onPath,
} from "../../jig-core/src/kit/sandbox-programs.ts";
export type { Distro, FoundPrograms, ProgramName } from "../../jig-core/src/kit/sandbox-programs.ts";

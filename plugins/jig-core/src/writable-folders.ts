// The folders the file tools may write without asking. Kept apart from the protected paths so the floor's write rule has
// one home, and so the path code there stays the length it is: the writing side needs only the three helpers below.
import { flavour, formsOf, isInside } from "./protected-paths.ts";

/**
 * The folders the file tools may write without asking: the working folder, plus the folders a person allowed when a
 * sandbox is running. A target is writable only when *every* form of it — the path as written and with its links
 * followed — is inside a writable folder's forms. That keeps a write inside the working folder writable whichever form
 * Pi hands over (on macOS `/var` is a link to `/private/var`), and a link out of the project still asks.
 */
export function writableFolders(
    folders: readonly string[],
    platform: NodeJS.Platform | undefined = process.platform,
): (absolute: string) => boolean {
    const sep = flavour(platform).sep;
    const wanted = folders.flatMap((folder) => formsOf(folder, platform));
    return (absolute) => {
        const have = formsOf(absolute, platform);
        return have.every((form) => wanted.some((folder) => isInside(form, folder, sep)));
    };
}

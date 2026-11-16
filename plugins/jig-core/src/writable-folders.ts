// The folders the file tools may write without asking. Kept apart from the protected paths so the floor's write rule has
// one home, and so the path code there stays the length it is: the writing side needs only the three helpers below.
import { flavour, formsOf, isInside } from "./protected-paths.ts";

/**
 * The folders the file tools may write without asking: the working folder, plus the folders a person allowed when a
 * sandbox is running. A write lands where its links lead, so the target's *real* form — links followed, the nearest
 * existing folder for a file not made yet, case folded — must be inside a writable folder's real form. One folder has
 * several spellings (`/var` and `/private/var` on macOS, a link to it) and the as-written form of a target spelled
 * differently is inside none of them; its real form is inside the real one. A link out of the project still asks,
 * because its real form is outside.
 */
export function writableFolders(
    folders: readonly string[],
    platform: NodeJS.Platform | undefined = process.platform,
): (absolute: string) => boolean {
    const pathApi = flavour(platform);
    const sep = pathApi.sep;
    // `formsOf` gives the folded form first and the folded, links-followed form last; only the real one is compared.
    const real = (value: string): string => formsOf(pathApi.resolve(value), platform).at(-1) ?? value;
    const wanted = folders.map((folder) => real(folder));
    return (absolute) => {
        const target = real(absolute);
        return wanted.some((folder) => isInside(target, folder, sep));
    };
}

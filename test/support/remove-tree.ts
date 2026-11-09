// Removing a temporary folder after a test: a child that is still writing can make rmdir fail with ENOTEMPTY, so retry
// the few times a slower process needs rather than failing the test at teardown.
import { rmSync } from "node:fs";

export function removeTree(folder: string): void {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

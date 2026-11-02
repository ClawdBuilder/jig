/** One extension as Pi lists it: its file, and where it came from (`sourceInfo` of `get_commands`). */
export interface LabelledExtension {
    path: string;
    sourceInfo?: { path: string; source: string; scope: string; origin: string; baseDir?: string };
}

/** The labels Pi in `piDir` shows for these extensions, in the same order. */
export function extensionLabels(piDir: string, extensions: readonly LabelledExtension[]): Promise<string[]>;

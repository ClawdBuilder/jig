export function checkDocs(root: string): { failures: string[]; warnings: string[] };
export function warningCounts(warnings: string[]): { paragraph: number; cell: number; readme: number; other: number };
export function baselineFailures(
    warnings: string[],
    baseline: Partial<Record<"paragraph" | "cell" | "readme" | "other", number>>,
): string[];

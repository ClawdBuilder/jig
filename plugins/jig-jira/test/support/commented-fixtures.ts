// What the tests of the `commented` filter share: issues with comments written to order, the two people of the fake Jira, and
// the `jira` section they run with.
import type { FakeUser } from "./fake-jira.ts";
import { cloudSection } from "./harness.ts";
import type { Harness } from "./harness.ts";

export const jane = (harness: Harness): FakeUser => harness.jira.users[0] as FakeUser;
export const sam = (harness: Harness): FakeUser => harness.jira.users[1] as FakeUser;

/** Adds an issue whose comments are `[author, created]`, oldest first. It was updated after every window used here. */
export function addIssue(
    harness: Harness,
    key: string,
    comments: ReadonlyArray<readonly [FakeUser, string]>,
    options: { updated?: string; summary?: string } = {},
): void {
    const number = Number(key.replace(/\D/g, ""));
    harness.jira.issues.set(key, {
        key,
        fields: {
            summary: options.summary ?? `Issue ${key}`,
            status: { id: "1", name: "Open" },
            issuetype: { id: "10002", name: "Task" },
            priority: { id: "3", name: "Medium" },
            assignee: null,
            labels: [],
            updated: options.updated ?? "2026-10-20T09:00:00.000+0000",
        },
        comments: comments.map(([author, created], index) => ({
            id: String(number * 1000 + index + 1),
            author,
            body: `Comment ${index + 1} on ${key}`,
            created,
            updated: created,
        })),
        transitions: [],
        histories: [],
    });
}

/** The `jira` section: the default one, with the given settings added. */
export const sectionWith = (more: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...cloudSection(),
    ...more,
});

/** The keys of the issues listed as matches in a `commented` result. */
export const matched = (text: string): string[] =>
    [...text.matchAll(/^(PROJ-\d+) \| /gm)].map((match) => match[1] as string);

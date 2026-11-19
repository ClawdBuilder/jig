// A section kept in jig.json for a plugin that is not loaded is off, not an unknown field: the session keeps the person's own
// settings, and the doctor says which plugins are off in one line. Real Pi session with the scripted model; the plugin that
// is not loaded is jig-jira, jig-session or jig-review, whose sections are in the table (src/plugin-table.ts).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { jigJira } from "../../jig-jira/src/index.ts";
import { jig } from "../src/client.ts";
import { runDoctor } from "../src/doctor.ts";
import { doctorContext } from "../src/doctor-checks.ts";
import { offLine } from "../src/doctor-off.ts";
import type { DoctorOptions } from "../src/doctor.ts";
import { runningJigState } from "../src/index.ts";
import { FEATURES } from "../src/plugin-table.ts";
import type { FakeUiScript } from "./support/fakes.ts";
import { startWorld } from "./support/session.ts";
import type { World, WorldOptions } from "./support/session.ts";
import { tempState } from "./support/state.ts";

const state = tempState();
let scratch: string;
beforeEach(() => {
    state.start();
    scratch = mkdtempSync(path.join(tmpdir(), "jig-off-sections-"));
});

let world: World | undefined;
afterEach(async () => {
    await world?.close();
    world = undefined;
    state.stop();
    rmSync(scratch, { recursive: true, force: true });
});
async function begin(options: WorldOptions = {}): Promise<World> {
    world = await startWorld(options);
    return world;
}

const ALLOW: FakeUiScript = { select: () => "Allow" };
/** The notice about the sandbox comes at every session start; this is about the configuration problems. */
const problemNotices = (w: World): string[] =>
    (w.ui?.notifications ?? []).map((notice) => notice.message).filter((message) => !message.startsWith("bash: "));

const JIRA = {
    site: "https://example.atlassian.net",
    auth: { email: "jane@example.test", token: "pass:work/jira-token" },
    projects: ["PROJ"],
};
const OFF_SECTIONS: Array<[string, unknown]> = [
    ["jira", JIRA],
    ["session", { compactWhenIdle: { afterSeconds: 600, minTokens: 20000 } }],
    ["review", { diffView: "split" }],
];

/** The personal protected-path entry for `marker`, as the API lists it, when it is in force. */
const entryFor = (marker: string): { kind: string; source: string } | undefined => {
    const found = jig()
        .protectedPaths.list()
        .find((entry) => entry.path === marker);
    return found === undefined ? undefined : { kind: found.kind, source: found.source };
};

describe("a section of a plugin that is not loaded", () => {
    for (const [section, body] of OFF_SECTIONS) {
        test(`${section}: no configuration problem, and the person's own protected path is in force`, async () => {
            const marker = path.join(scratch, "marker-folder");
            const w = await begin({ config: { protectedPaths: { secret: [marker] }, [section]: body }, ui: ALLOW });
            assert.deepEqual(problemNotices(w), []);
            assert.deepEqual(runningJigState()?.personal.problems, []);
            assert.deepEqual(entryFor(marker), { kind: "secret", source: "personal" });
        });
    }

    test("a key that belongs to no plugin still fails, and the defaults apply", async () => {
        const marker = path.join(scratch, "marker-folder");
        const w = await begin({ config: { protectedPaths: { secret: [marker] }, madeup: {}, jira: JIRA }, ui: ALLOW });
        const notices = problemNotices(w);
        assert.equal(notices.length, 1);
        assert.match(notices[0] ?? "", /jig-core: 1 configuration problem\n.*jig\.json: madeup: unknown field/);
        assert.doesNotMatch(notices[0] ?? "", /jira/);
        assert.equal(entryFor(marker), undefined, "the file is not used while one key is wrong");
    });

    test("with jig-jira loaded its section is checked as before: a valid one is kept", async () => {
        const marker = path.join(scratch, "marker-folder");
        const w = await begin({
            config: { protectedPaths: { secret: [marker] }, jira: JIRA },
            plugins: [jigJira()],
            ui: ALLOW,
        });
        assert.deepEqual(problemNotices(w), []);
        assert.notEqual(jig().config.section("jira"), undefined, "jig-jira is handed its section");
        assert.deepEqual(entryFor(marker), { kind: "secret", source: "personal" });
    });

    test("with jig-jira loaded its section is checked as before: an invalid one is reported", async () => {
        const marker = path.join(scratch, "marker-folder");
        const w = await begin({
            config: { protectedPaths: { secret: [marker] }, jira: { ...JIRA, colour: "red" } },
            plugins: [jigJira()],
            ui: ALLOW,
        });
        const notices = problemNotices(w);
        assert.equal(notices.length, 1);
        assert.match(notices[0] ?? "", /jig-core: 1 configuration problem\n.*jira.*colour: unknown field/);
        assert.equal(jig().config.section("jira"), undefined, "the plugin does not get a section that is wrong");
        assert.deepEqual(entryFor(marker), { kind: "secret", source: "personal" }, "jig-core's own settings stay");
    });
});

const OPTIONS: DoctorOptions = {
    platform: "linux",
    nodeVersion: "24.15.0",
    piVersion: () => "1.5.2",
    jigVersion: "0.5.11",
    pathLookup: () => "/usr/bin/program",
    run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
};

describe("the doctor's one Off line", () => {
    test("in a session it names the plugins that are not loaded, sorted, and no settings file", async () => {
        const marker = path.join(scratch, "marker-folder");
        await begin({
            config: { protectedPaths: { secret: [marker] }, jira: JIRA, review: { diffView: "split" } },
            plugins: [jigJira()],
            ui: ALLOW,
        });
        const live = runningJigState();
        assert.ok(live);
        const report = await runDoctor(doctorContext(live), { ...OPTIONS, home: scratch });
        const off = report.lines.filter((line) => line.id.startsWith("config.filtered"));
        assert.equal(off.length, 1, JSON.stringify(off));
        const expected = Object.values(FEATURES)
            .flatMap((entry) => (entry.section === undefined || entry.section === "jira" ? [] : [entry.feature]))
            .sort();
        assert.equal(off[0]?.id, "config.filtered.off");
        assert.equal(off[0]?.level, "skip");
        assert.equal(off[0]?.title, `Off: ${expected.join(", ")}.`);
        assert.ok(expected.includes("review") && expected.includes("session"), "the two new table entries are counted");
        assert.equal(off[0]?.fix, undefined, "a session cannot tell which settings file holds the filter");
        assert.equal(
            report.lines.some((line) => line.id.startsWith("config.problem")),
            false,
            "the sections left in the file are not problems",
        );
    });

    test("with every plugin loaded there is no Off line", () => {
        assert.deepEqual(offLine(undefined), []);
        assert.deepEqual(offLine({ features: [], alwaysOn: [], offSections: [] }), []);
    });

    test("in the terminal both lists feed one line, names sorted, and the fix names each settings file once", () => {
        const [line, ...rest] = offLine({
            features: [
                { feature: "logs", section: "logs", settings: "/home/a/settings.json" },
                { feature: "api", section: "api", settings: "/home/a/settings.json" },
                { feature: "jira", section: "jira", settings: "/work/.pi/settings.json" },
            ],
            alwaysOn: [{ feature: "git", plugin: "jig-git", settings: "/home/a/settings.json" }],
            offSections: ["logs", "api", "jira", "git"],
        });
        assert.deepEqual(rest, []);
        assert.equal(line?.id, "config.filtered.off");
        assert.equal(line?.level, "skip");
        assert.equal(line?.group, "config");
        assert.equal(line?.title, "Off: api, git, jira, logs.");
        assert.equal(
            line?.fix,
            "Turn one on by removing its filter in /home/a/settings.json or /work/.pi/settings.json.",
        );
        assert.doesNotMatch(`${line?.title} ${line?.detail} ${line?.fix}`, /\/jig plugins|jig setup|jig update/);
    });
});

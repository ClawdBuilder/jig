// Profiles and overlays, the way a person with two employers would meet them: jig-acme is chosen by the working folder or the git
// remote, by name, or as the only company; otherwise it is dormant. And its overlay is merged into Jig's own `jira` skill, which
// the model then reads as one skill.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withJig } from "../src/jig/client.ts";
import { startWorld } from "./support/world.ts";
import type { World } from "./support/world.ts";

let scratch: string;
let world: World | undefined;
beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), "jig-acme-work-"));
});
afterEach(async () => {
    await world?.close();
    world = undefined;
    rmSync(scratch, { recursive: true, force: true });
});

const profiles = (folder: string) => ({
    profiles: {
        acme: { plugin: "jig-acme", when: { folders: [`${folder}/work/acme/**`], remotes: ["github.com:acme-org/*"] } },
        globex: { plugin: "jig-globex", when: { folders: [`${folder}/work/globex/**`] } },
    },
});

/** A second company, as a person with two employers has installed: it only registers. */
function globex(): (pi: ExtensionAPI) => void {
    return () => {
        withJig((api) => {
            const view = api.profiles?.register("jig-globex", { displayName: "Globex", skills: ["globex-wiki"] });
            view?.config.addEnvironments({ "globex-stage": { kind: "test" } });
        });
    };
}

function folder(...parts: string[]): string {
    const dir = path.join(scratch, ...parts);
    mkdirSync(dir, { recursive: true });
    return dir;
}

async function lines(w: World, command: string): Promise<string[]> {
    const run = w.host.commands.get(command);
    assert.ok(run, command);
    const before = w.ui.notifications.length;
    await run.handler("", w.ctx as never);
    return w.ui.notifications.slice(before).flatMap((item) => item.message.split("\n"));
}

describe("which company is active", () => {
    test("by folder: the Acme environments, defaults and status apply", async () => {
        world = await startWorld({
            personal: profiles(scratch),
            cwd: folder("work", "acme", "orders"),
            extra: [globex()],
        });
        assert.equal(world.api.profiles?.active().reason, "folder");
        assert.equal(world.api.environments.kindOf("staging"), "test");
        assert.equal(world.api.environments.kindOf("globex-stage"), "production", "the other company is dormant");
        assert.ok(world.api.config.section("jira") !== undefined, "Acme's Jira defaults apply");
        assert.deepEqual(await world.problems(), []);
        assert.ok((await world.jigLines()).some((line) => line.startsWith("jig-acme:")));
    });

    test("by remote: a folder anywhere whose origin matches", async () => {
        const dir = folder("elsewhere", "orders-api");
        mkdirSync(path.join(dir, ".git"));
        writeFileSync(
            path.join(dir, ".git", "config"),
            '[remote "origin"]\n\turl = git@github.com:acme-org/orders-api.git\n',
        );
        world = await startWorld({ personal: profiles(scratch), cwd: dir });
        const active = world.api.profiles?.active();
        assert.equal(active?.reason, "remote");
        assert.match(active?.why ?? "", /github\.com:acme-org\/orders-api/);
        assert.equal(world.api.environments.kindOf("staging"), "test");
    });

    test("by name: jig.json says which, wherever the session is", async () => {
        world = await startWorld({ personal: { ...profiles(scratch), profile: "acme" }, cwd: folder("somewhere") });
        assert.equal(world.api.profiles?.active().reason, "explicit");
        assert.equal(world.api.environments.kindOf("staging"), "test");
    });

    test("by the session's own choice, kept in the session file", async () => {
        world = await startWorld({
            personal: { ...profiles(scratch), profile: "globex" },
            cwd: folder("somewhere"),
            branch: [{ type: "custom", customType: "jig-profile", data: { name: "acme" } }],
        });
        assert.equal(world.api.profiles?.active().reason, "session");
        assert.equal(world.api.environments.kindOf("staging"), "test");
    });

    test("as the only company, with no profiles section: nothing to configure", async () => {
        world = await startWorld({ cwd: folder("anywhere") });
        assert.equal(world.api.profiles?.active().reason, "sole");
        assert.equal(world.api.environments.kindOf("staging"), "test");
    });

    test("none: outside Acme's folders, nothing of Acme's applies and its production names count as production", async () => {
        world = await startWorld({
            personal: profiles(scratch),
            cwd: folder("work", "globex", "app"),
            extra: [globex()],
        });
        assert.equal(world.api.profiles?.active().profile, "globex");
        await world.close();
        world = await startWorld({ personal: profiles(scratch), cwd: folder("home") });
        assert.equal(world.api.profiles?.active().reason, "none");
        assert.equal(world.api.environments.kindOf("staging"), "production", "unknown means production");
        assert.equal(world.api.config.section("jira"), undefined, "no Acme defaults");
        assert.ok(!(await world.jigLines()).some((line) => line.startsWith("jig-acme:")), "no Acme status line");
    });

    test("what only protects stays on while dormant: the credential file stays protected", async () => {
        world = await startWorld({ personal: profiles(scratch), cwd: folder("home") });
        assert.ok(world.api.protectedPaths.list().some((entry) => entry.shown === "~/.acme/credentials.json"));
    });

    test("/profile and /jig say which is active and why", async () => {
        world = await startWorld({ personal: profiles(scratch), cwd: folder("work", "acme", "orders") });
        const shown = await lines(world, "profile");
        assert.match(shown[0] ?? "", /^Profile: acme \(jig-acme\): the working folder matches/);
        assert.ok((await world.jigLines()).some((line) => line.startsWith("Profile: acme (jig-acme)")));
    });
});

describe("the Jira overlay", () => {
    test("is merged into Jig's own jira skill: the generic text unchanged, then Acme's rules", async () => {
        world = await startWorld({ cwd: folder("anywhere"), genericSkills: true });
        const merged = path.join(world.stateDir, "skills", "jig-acme", "jira", "SKILL.md");
        assert.ok(existsSync(merged), "written at session start");
        const generic = readFileSync(
            path.resolve(import.meta.dirname, "../../../plugins/jig-jira/skills/jira/SKILL.md"),
            "utf8",
        );
        const text = readFileSync(merged, "utf8");
        assert.ok(text.startsWith(generic.trimEnd()));
        const overlay = readFileSync(path.resolve(import.meta.dirname, "../overlays/jira.md"), "utf8");
        assert.ok(text.endsWith(`\n\n## Acme rules\n\n${overlay.trimEnd()}\n`));
    });

    test("the model sees one jira skill, at the merged copy; Acme's own skill is listed only while Acme is active", async () => {
        world = await startWorld({
            personal: profiles(scratch),
            cwd: folder("work", "acme", "orders"),
            genericSkills: true,
            extra: [globex()],
        });
        const generic = path.resolve(import.meta.dirname, "../../../plugins/jig-jira/skills/jira/SKILL.md");
        const turn = {
            skills: [
                { name: "jira", description: "Jira work", filePath: generic, baseDir: path.dirname(generic) },
                {
                    name: "acme-releases",
                    description: "Releases",
                    filePath: "/pkg/skills/acme-releases/SKILL.md",
                    baseDir: "/pkg/skills/acme-releases",
                },
                {
                    name: "globex-wiki",
                    description: "Wiki",
                    filePath: "/g/globex-wiki/SKILL.md",
                    baseDir: "/g/globex-wiki",
                },
            ],
        };
        await world.host.fire("before_agent_start", { systemPromptOptions: turn }, world.ctx);
        assert.deepEqual(
            turn.skills.map((skill) => skill.name),
            ["jira", "acme-releases"],
            "one jira, no acme-jira, and no skill of the dormant company",
        );
        assert.equal(turn.skills[0]?.filePath, path.join(world.stateDir, "skills", "acme", "jira", "SKILL.md"));
        assert.equal(turn.skills[0]?.description, "Jira work", "the generic description is the one the model sees");
    });

    test("when Acme is dormant the generic skill is untouched and Acme's skill is not listed", async () => {
        world = await startWorld({ personal: profiles(scratch), cwd: folder("home"), genericSkills: true });
        const generic = path.resolve(import.meta.dirname, "../../../plugins/jig-jira/skills/jira/SKILL.md");
        const turn = {
            skills: [
                { name: "jira", description: "Jira work", filePath: generic, baseDir: path.dirname(generic) },
                {
                    name: "acme-releases",
                    description: "Releases",
                    filePath: "/pkg/skills/acme-releases/SKILL.md",
                    baseDir: "/pkg",
                },
            ],
        };
        await world.host.fire("before_agent_start", { systemPromptOptions: turn }, world.ctx);
        assert.deepEqual(
            turn.skills.map((skill) => skill.filePath),
            [generic],
        );
        assert.ok(!existsSync(path.join(world.stateDir, "skills", "acme")), "nothing merged");
    });
});

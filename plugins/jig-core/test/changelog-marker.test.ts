// `jig update` keeps Pi's "last changelog shown" marker for Jig. Pi keys it by the pinned source, so a new release is a new
// key and Pi would show nothing; after `pi install` the new key must carry the version the person last saw. The unit tests
// run on temporary homes; one test runs Pi 1.5's own package manager and `getExtensionChangelogUpdates` on the result.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, test } from "node:test";
import { carryChangelogMarker, changelogKey } from "../src/cli/changelog-marker.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PI_DIST = path.join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist");
const UPDATE = path.join(ROOT, "plugins/jig-core/src/cli/update.ts");
const NAME = "@clawdbuilder/jig";
const BEDROCK = "@clawdbuilder/jig-bedrock";

let root: string;
let home: string;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "jig-marker-"));
    home = path.join(root, "home");
    mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const jigKey = (version?: string, scope: "user" | "project" = "user"): string =>
    changelogKey(version === undefined ? `npm:${NAME}` : `npm:${NAME}@${version}`, scope);
const bedrockKey = changelogKey(`npm:${BEDROCK}`, "user");

/** Pi's own file format: two spaces, no final newline (`JSON.stringify(settings, null, 2)` in its settings manager). */
function piText(settings: unknown): string {
    return JSON.stringify(settings, null, 2);
}

function writeSettings(text: string, mode = 0o644): string {
    const file = path.join(home, "settings.json");
    writeFileSync(file, text);
    chmodSync(file, mode);
    return file;
}

/** A settings file as Pi leaves it after `pi install npm:@clawdbuilder/jig@<pinned>`, with the given markers. */
function settingsWith(pinned: string, markers: Record<string, unknown> | undefined): Record<string, unknown> {
    return {
        lastChangelogVersion: "1.5.2",
        packages: [`npm:${NAME}@${pinned}`, `npm:${BEDROCK}`],
        ...(markers === undefined ? {} : { extensionChangelogVersions: markers }),
        defaultProvider: "example",
    };
}

function read(): string {
    return readFileSync(path.join(home, "settings.json"), "utf8");
}

function markers(): Record<string, unknown> {
    const settings = JSON.parse(read().replace(/^\uFEFF/, "")) as {
        extensionChangelogVersions: Record<string, unknown>;
    };
    return settings.extensionChangelogVersions;
}

describe("carrying the marker to the new pinned source", () => {
    test("the old key's version moves to the new key, and the old key is gone", () => {
        writeSettings(piText(settingsWith("0.5.9", { [jigKey("0.5.8")]: "0.5.8", [bedrockKey]: "1.0.0" })));
        assert.equal(carryChangelogMarker(home, NAME, "0.5.9"), true);
        assert.deepEqual(markers(), { [bedrockKey]: "1.0.0", [jigKey("0.5.9")]: "0.5.8" });
        assert.equal(jigKey("0.5.8") in markers(), false);
    });

    test("only that field changes: every other line of the file is the same bytes", () => {
        const before = piText(settingsWith("0.5.9", { [bedrockKey]: "1.0.0", [jigKey("0.5.8")]: "0.5.8" }));
        writeSettings(before);
        carryChangelogMarker(home, NAME, "0.5.9");
        const after = read();
        const outside = (text: string): string[] => {
            const lines = text.split("\n");
            const start = lines.findIndex((line) => line.startsWith('  "extensionChangelogVersions"'));
            const end = lines.findIndex((line, index) => index > start && line === "  },");
            return [...lines.slice(0, start), ...lines.slice(end + 1)];
        };
        assert.deepEqual(outside(after), outside(before));
        assert.equal(
            after,
            piText(settingsWith("0.5.9", { [bedrockKey]: "1.0.0", [jigKey("0.5.9")]: "0.5.8" })),
            "Pi's own format, jig-bedrock's key first, where it was, and the new key after it, as Pi appends",
        );
    });

    test("several stale keys: the newest version is carried, compared as semver, and every old Jig key goes", () => {
        writeSettings(
            piText(
                settingsWith("0.5.11", {
                    [jigKey("0.5.6")]: "0.5.6",
                    [jigKey("0.5.9")]: "0.5.9",
                    [jigKey("0.5.10")]: "0.5.10",
                    [jigKey()]: "0.5.2",
                    [bedrockKey]: "1.0.0",
                }),
            ),
        );
        carryChangelogMarker(home, NAME, "0.5.11");
        assert.deepEqual(markers(), { [bedrockKey]: "1.0.0", [jigKey("0.5.11")]: "0.5.10" });
    });

    test("a key with no version at all is an older Jig source too", () => {
        writeSettings(piText(settingsWith("0.5.9", { [jigKey()]: "0.5.4" })));
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.deepEqual(markers(), { [jigKey("0.5.9")]: "0.5.4" });
    });

    test("a version newer than the installed Jig is not carried, and an unreadable one is not either", () => {
        writeSettings(
            piText(
                settingsWith("0.5.9", {
                    [jigKey("0.6.0")]: "0.6.0",
                    [jigKey("0.5.7")]: "latest",
                    [jigKey("0.5.8")]: "0.5.8",
                }),
            ),
        );
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.deepEqual(markers(), { [jigKey("0.5.9")]: "0.5.8" });
    });

    test("with nothing usable to carry the old keys still go and no empty key appears", () => {
        writeSettings(piText(settingsWith("0.5.8", { [jigKey("0.5.9")]: "0.5.9", [bedrockKey]: "1.0.0" })));
        assert.equal(carryChangelogMarker(home, NAME, "0.5.8"), true);
        assert.deepEqual(markers(), { [bedrockKey]: "1.0.0" });
    });

    test("a value already on the new key is left alone", () => {
        writeSettings(piText(settingsWith("0.5.9", { [jigKey("0.5.8")]: "0.5.8", [jigKey("0.5.9")]: "0.5.7" })));
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.deepEqual(markers(), { [jigKey("0.5.9")]: "0.5.7" });
    });

    test("another package's key and a project-scope Jig key are never touched", () => {
        const other = changelogKey("npm:@acme/tools@1.2.0", "user");
        writeSettings(
            piText(
                settingsWith("0.5.9", {
                    [other]: "1.2.0",
                    [bedrockKey]: "1.0.0",
                    [jigKey("0.5.7", "project")]: "0.5.7",
                    [jigKey("0.5.8")]: "0.5.8",
                }),
            ),
        );
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.deepEqual(markers(), {
            [other]: "1.2.0",
            [bedrockKey]: "1.0.0",
            [jigKey("0.5.7", "project")]: "0.5.7",
            [jigKey("0.5.9")]: "0.5.8",
        });
    });

    test("an object entry in packages names the source, and a key that is not JSON is left alone", () => {
        const text = piText({
            packages: [{ source: `npm:${NAME}@0.5.9`, extensions: ["index.js"] }],
            extensionChangelogVersions: { [jigKey("0.5.8")]: "0.5.8", "not json": "9.9.9" },
        });
        writeSettings(text);
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.deepEqual(markers(), { "not json": "9.9.9", [jigKey("0.5.9")]: "0.5.8" });
        assert.deepEqual((JSON.parse(read()) as { packages: unknown }).packages, [
            { source: `npm:${NAME}@0.5.9`, extensions: ["index.js"] },
        ]);
    });
});

describe("when nothing changes", () => {
    /** The call changes no byte, writes nothing beside the file and returns false. */
    function unchanged(text: string): void {
        writeSettings(text);
        assert.equal(carryChangelogMarker(home, NAME, "0.5.9"), false);
        assert.equal(read(), text);
        assert.deepEqual(readdirSync(home), ["settings.json"]);
    }

    test("a file without the field", () => unchanged(piText(settingsWith("0.5.9", undefined))));

    test("no older Jig key, only jig-bedrock's and the new key's", () =>
        unchanged(piText(settingsWith("0.5.9", { [bedrockKey]: "1.0.0", [jigKey("0.5.9")]: "0.5.9" }))));

    test("the field is not an object", () =>
        unchanged(piText({ ...settingsWith("0.5.9", undefined), extensionChangelogVersions: [] })));

    test("the home does not list Jig", () =>
        unchanged(
            piText({ packages: [`npm:${BEDROCK}`], extensionChangelogVersions: { [jigKey("0.5.8")]: "0.5.8" } }),
        ));

    test("a file that is not JSON, and a home with no file", () => {
        unchanged("{ not json");
        rmSync(path.join(home, "settings.json"));
        assert.equal(carryChangelogMarker(home, NAME, "0.5.9"), false);
        assert.deepEqual(readdirSync(home), []);
    });
});

describe("how the file is written", () => {
    const stale = (): Record<string, unknown> => settingsWith("0.5.9", { [jigKey("0.5.8")]: "0.5.8" });

    test("the indent, the final newline and the permissions the file had are kept", () => {
        const file = writeSettings(`${JSON.stringify(stale(), null, "\t")}\n`, 0o600);
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.equal(read(), `${JSON.stringify(settingsWith("0.5.9", { [jigKey("0.5.9")]: "0.5.8" }), null, "\t")}\n`);
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.deepEqual(readdirSync(home), ["settings.json"]);
    });

    test("a byte order mark is kept", () => {
        writeSettings(`﻿${piText(stale())}`);
        carryChangelogMarker(home, NAME, "0.5.9");
        assert.equal(read().startsWith("﻿{"), true);
        assert.deepEqual(markers(), { [jigKey("0.5.9")]: "0.5.8" });
    });

    test("a settings file that is a link is written through, and the link stays", () => {
        const real = path.join(root, "dotfiles", "pi-settings.json");
        mkdirSync(path.dirname(real), { recursive: true });
        writeFileSync(real, piText(stale()));
        symlinkSync(real, path.join(home, "settings.json"));
        assert.equal(carryChangelogMarker(home, NAME, "0.5.9"), true);
        assert.equal(statSync(path.join(home, "settings.json")).isFile(), true);
        assert.equal(existsSync(real), true);
        assert.deepEqual(
            (JSON.parse(readFileSync(real, "utf8")) as { extensionChangelogVersions: unknown })
                .extensionChangelogVersions,
            { [jigKey("0.5.9")]: "0.5.8" },
        );
    });
});

describe("the key is the one Pi reads", () => {
    test("it equals Pi 1.5's getSourcePackageKey, source first and scope second", async () => {
        const pi = (await import(pathToFileURL(path.join(PI_DIST, "core/source-info.js")).href)) as {
            getSourcePackageKey: (identity: { source: string; scope: string }) => string;
        };
        for (const scope of ["user", "project"] as const) {
            for (const source of [`npm:${NAME}@0.5.9`, `npm:${NAME}`, `npm:${BEDROCK}`]) {
                assert.equal(changelogKey(source, scope), pi.getSourcePackageKey({ source, scope }));
            }
        }
        assert.equal(
            changelogKey(`npm:${NAME}@0.5.9`, "user"),
            '{"source":"npm:@clawdbuilder/jig@0.5.9","scope":"user"}',
        );
    });

    test("with the carried marker, Pi's first interactive start lists Jig's new entries; without it, none", async () => {
        process.env.PI_OFFLINE = "1";
        const load = async (file: string): Promise<Record<string, any>> =>
            (await import(pathToFileURL(path.join(PI_DIST, file)).href)) as Record<string, any>;
        const { InteractiveMode } = await load("modes/interactive/interactive-mode.js");
        const { SettingsManager } = await load("core/settings-manager.js");
        const { DefaultPackageManager } = await load("core/package-manager.js");
        const { createSourceInfo } = await load("core/source-info.js");

        // Jig 0.5.9 as `pi install` leaves it in the home, with a changelog.
        const folder = path.join(home, "npm", "node_modules", ...NAME.split("/"));
        mkdirSync(folder, { recursive: true });
        writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({ name: NAME, version: "0.5.9", pi: { extensions: ["./index.js"] } }),
        );
        writeFileSync(path.join(folder, "index.js"), "export default function () {}\n");
        writeFileSync(
            path.join(folder, "CHANGELOG.md"),
            "# Changelog\n\n## [0.5.9] - 2026-11-17\n\n### Fixed\n- The new fix.\n\n## [0.5.8] - 2026-11-16\n\n### Added\n- The old addition.\n",
        );
        const work = path.join(root, "work");
        mkdirSync(work, { recursive: true });

        /** Pi's own start: its package manager resolves the home's packages, then its changelog code reads the markers. */
        async function firstStart(): Promise<Array<{ name: string; version: string; markdown: string }>> {
            const settings = SettingsManager.create(work, home);
            const manager = new DefaultPackageManager({ cwd: work, agentDir: home, settingsManager: settings });
            const resolved = await manager.resolve();
            const extensions = resolved.extensions.map((one: { path: string; metadata: unknown }) => ({
                sourceInfo: createSourceInfo(one.path, one.metadata),
            }));
            const self = {
                session: { state: { messages: [] }, resourceLoader: { getExtensions: () => ({ extensions }) } },
                settingsManager: settings,
                readPackageJson: InteractiveMode.prototype.readPackageJson,
            };
            const updates = InteractiveMode.prototype.getExtensionChangelogUpdates.call(self);
            await settings.flush();
            return updates;
        }

        // Before: the markers Pi wrote for earlier pins, and the new pin has none: Pi calls it a fresh install.
        const stale = piText(settingsWith("0.5.9", { [jigKey("0.5.8")]: "0.5.8", [bedrockKey]: "1.0.0" }));
        writeSettings(stale);
        assert.deepEqual(await firstStart(), [], "without the carried marker Pi shows nothing");

        // After: the same file, moved by Jig's code.
        writeSettings(stale);
        assert.equal(carryChangelogMarker(home, NAME, "0.5.9"), true);
        const updates = await firstStart();
        assert.equal(updates.length, 1);
        assert.equal(updates[0]?.name, NAME);
        assert.equal(updates[0]?.version, "0.5.9");
        assert.match(updates[0]?.markdown ?? "", /The new fix\./);
        assert.doesNotMatch(updates[0]?.markdown ?? "", /The old addition\./);
        assert.equal(markers()[jigKey("0.5.9")], "0.5.9", "Pi then records what it showed");
    });
});

describe("jig update", () => {
    let bin: string;

    /** A Pi that does what `pi install` does to the home: the package folder at that version and the pinned source in
     *  settings.json, written in Pi's own format. `pi update` does nothing, and fails when asked to. */
    const fakePi = `const fs = require("node:fs"), path = require("node:path");
const [command, source] = process.argv.slice(2);
const home = process.env.PI_CODING_AGENT_DIR;
if (command === "update" && process.env.FAKE_UPDATE_FAILS) process.exit(1);
if (command === "install") {
    const version = source.split("@").pop();
    const folder = path.join(home, "npm", "node_modules", "@clawdbuilder", "jig");
    fs.mkdirSync(path.join(folder, "bin"), { recursive: true });
    fs.writeFileSync(path.join(folder, "bin", "jig.mjs"), "#!/usr/bin/env node\\n");
    fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: "@clawdbuilder/jig", version }));
    const file = path.join(home, "settings.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    data.packages = data.packages.map((one) => (one.startsWith("npm:@clawdbuilder/jig@") ? source : one));
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
`;
    const fakeNpm = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("versions")) process.stdout.write('["0.5.8","0.5.9"]');
else process.stdout.write(JSON.stringify({ version: "0.5.9", jig: { agents: { pi: { minimum: "1.4.0", tested: "1.5.2" } } } }));
`;

    /** Jig `installed` in the home, listed pinned as Pi lists it, with these markers. */
    function installHome(installed: string, found: Record<string, unknown> | undefined): void {
        const folder = path.join(home, "npm", "node_modules", "@clawdbuilder", "jig");
        mkdirSync(path.join(folder, "bin"), { recursive: true });
        writeFileSync(path.join(folder, "bin", "jig.mjs"), "#!/usr/bin/env node\n");
        writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: NAME, version: installed }));
        writeSettings(piText(settingsWith(installed, found)));
    }

    /** Runs `jig update` in its own process, with the fake Pi and npm, and gives back the code and what it printed. */
    function run(args: string[], extra: Record<string, string> = {}): { code: number | null; stderr: string } {
        bin = path.join(root, "bin");
        mkdirSync(bin, { recursive: true });
        writeFileSync(path.join(bin, "fake-pi.cjs"), fakePi);
        writeFileSync(path.join(bin, "npm"), fakeNpm, { mode: 0o755 });
        const script = `const { update } = await import(${JSON.stringify(pathToFileURL(UPDATE).href)});
process.exitCode = await update(JSON.parse(process.env.UPDATE_ARGS), {
    home: process.env.UPDATE_HOME,
    pi: { host: process.env.UPDATE_HOME, command: process.execPath, prefix: [process.env.FAKE_PI], version: "1.5.2" },
});`;
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
            encoding: "utf8",
            env: {
                ...process.env,
                ...extra,
                CI: "",
                PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
                UPDATE_ARGS: JSON.stringify(args),
                UPDATE_HOME: home,
                FAKE_PI: path.join(bin, "fake-pi.cjs"),
            },
        });
        return { code: result.status, stderr: result.stderr };
    }

    test("an update to a new pinned version carries the marker, and keeps jig-bedrock's", () => {
        installHome("0.5.8", { [jigKey("0.5.7")]: "0.5.7", [jigKey("0.5.8")]: "0.5.8", [bedrockKey]: "1.0.0" });
        const result = run(["--yes"]);
        assert.equal(result.code, 0, result.stderr);
        assert.deepEqual((JSON.parse(read()) as { packages: string[] }).packages, [
            `npm:${NAME}@0.5.9`,
            `npm:${BEDROCK}`,
        ]);
        assert.deepEqual(markers(), { [bedrockKey]: "1.0.0", [jigKey("0.5.9")]: "0.5.8" });
    });

    test("the marker is carried even when the update's next step fails, because Jig did move", () => {
        installHome("0.5.8", { [jigKey("0.5.8")]: "0.5.8" });
        const result = run(["--yes"], { FAKE_UPDATE_FAILS: "1" });
        assert.equal(result.code, 1);
        assert.deepEqual(markers(), { [jigKey("0.5.9")]: "0.5.8" });
    });

    test("an update that installs nothing new, and an update to the same version, write nothing", () => {
        installHome("0.5.9", { [jigKey("0.5.8")]: "0.5.8", [jigKey("0.5.9")]: "0.5.9" });
        const before = read();
        assert.equal(run(["--yes"]).code, 0);
        assert.equal(read(), before, "already the newest");
        assert.equal(run(["--extensions", "--yes"]).code, 0);
        assert.equal(read(), before, "Pi's own update of the other packages");
        assert.equal(run(["--self", "--to", "0.5.9", "--yes"]).code, 0);
        assert.equal(read(), before, "the same version again");
    });

    test("an update with no marker field writes none", () => {
        installHome("0.5.8", undefined);
        const result = run(["--yes"]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal("extensionChangelogVersions" in (JSON.parse(read()) as object), false);
    });

    test("--check changes nothing", () => {
        installHome("0.5.8", { [jigKey("0.5.8")]: "0.5.8" });
        const before = read();
        assert.equal(run(["--check"]).code, 0);
        assert.equal(read(), before);
    });
});

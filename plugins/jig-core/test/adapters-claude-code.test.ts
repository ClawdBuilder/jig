// The Claude Code plugin, as files: `.claude-plugin/plugin.json` and `marketplace.json` at the package root (Claude Code reads the root as the plugin), and the
// skill they name. The files are read field by field, because a wrong one is only found when a person installs the plugin. The skill is read by a model in an agent
// that is not Pi, so it is held to what the gateway really offers: `dist/tools.json` lists the actions, and the skill may name those and no other.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { parse } from "yaml";
import { CLAUDE_ALLOW_RULE, CLAUDE_MARKETPLACE, CLAUDE_PLUGIN } from "../src/doctor-agents.ts";
import { NO_SCREEN } from "../src/gateway/runtime.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PLUGIN_FILE = path.join(ROOT, ".claude-plugin/plugin.json");
const MARKETPLACE_FILE = path.join(ROOT, ".claude-plugin/marketplace.json");
const SKILLS = path.join(ROOT, "adapters/claude-code/skills");
const SKILL_FILE = path.join(SKILLS, "git/SKILL.md");
const TOOLS_FILE = path.join(ROOT, "plugins/jig-core/dist/tools.json");
const PI_SKILL_FILE = path.join(ROOT, "plugins/jig-git/skills/git/SKILL.md");

type Json = Record<string, unknown>;

/** Claude Code's placeholder, `${name}`, written from parts so that no string in this file looks like a template that lost its backticks. */
const placeholder = (name: string): string => ["$", "{", name, "}"].join("");

function json(file: string): Json {
    return JSON.parse(readFileSync(file, "utf8")) as Json;
}

const packageVersion = (): string => json(path.join(ROOT, "package.json")).version as string;

describe(".claude-plugin/plugin.json", () => {
    const plugin = json(PLUGIN_FILE);

    test("names the plugin, its version, a one-sentence description and its author", () => {
        assert.equal(plugin.name, CLAUDE_PLUGIN);
        assert.equal(plugin.name, "jig");
        assert.equal(
            plugin.version,
            packageVersion(),
            "the version moves with package.json (release.mjs, check-version-pins.mjs)",
        );
        assert.equal(typeof plugin.description, "string");
        assert.match(plugin.description as string, /^[^\n]+\.$/, "one sentence, on one line");
        assert.deepEqual(plugin.author, { name: "Jig Contributors" });
    });

    test("asks for one value, the folder that holds jig.json, and does not require it", () => {
        const config = plugin.userConfig as Record<string, Json>;
        assert.deepEqual(Object.keys(config), ["jig_home"]);
        const home = config.jig_home as Json;
        assert.equal(home.type, "directory");
        assert.equal(home.required, false);
        assert.equal(typeof home.title, "string");
        assert.match(home.description as string, /jig\.json/);
        assert.match(home.description as string, /built-in defaults/, "it says what leaving it empty does");
    });

    test("starts the built gateway with node, by a path inside the plugin, and passes the folder as JIG_HOME", () => {
        const servers = plugin.mcpServers as Record<string, Json>;
        assert.deepEqual(Object.keys(servers), ["jig"], "one server, named jig: its tools are mcp__plugin_jig_jig__*");
        const server = servers.jig as Json;
        assert.equal(server.command, "node");
        assert.deepEqual(server.args, [`${placeholder("CLAUDE_PLUGIN_ROOT")}/plugins/jig-core/dist/jig-gateway.mjs`]);
        const started = (server.args as string[])[0]?.replace(placeholder("CLAUDE_PLUGIN_ROOT"), ROOT) ?? "";
        assert.equal(existsSync(started), true, `${started} is in the repository`);
        assert.deepEqual(
            server.env,
            { JIG_HOME: placeholder("user_config.jig_home") },
            "an unset value arrives empty, and the gateway counts empty as unset",
        );
        assert.equal(
            CLAUDE_ALLOW_RULE,
            `mcp__plugin_${plugin.name}_${Object.keys(servers)[0]}__*`,
            "the rule the doctor names",
        );
    });

    test("names the skills folder, which holds git/SKILL.md", () => {
        assert.equal(plugin.skills, "./adapters/claude-code/skills");
        assert.equal(existsSync(SKILL_FILE), true);
    });

    test("has no hooks and no commands, here or beside it: this version adds no approval question and no shell guard", () => {
        assert.equal("hooks" in plugin, false);
        assert.equal("commands" in plugin, false);
        for (const left of [".mcp.json", "hooks", "commands"]) {
            assert.equal(existsSync(path.join(ROOT, left)), false, `${left} is not at the package root`);
        }
    });

    test("holds nothing else", () => {
        assert.deepEqual(Object.keys(plugin).sort(), [
            "author",
            "description",
            "mcpServers",
            "name",
            "skills",
            "userConfig",
            "version",
        ]);
    });
});

describe(".claude-plugin/marketplace.json", () => {
    const marketplace = json(MARKETPLACE_FILE);

    test("is the marketplace clawdbuilder, owned by Jig Contributors", () => {
        assert.equal(marketplace.name, CLAUDE_MARKETPLACE);
        assert.equal(marketplace.name, "clawdbuilder");
        assert.deepEqual(marketplace.owner, { name: "Jig Contributors" });
        assert.match(marketplace.description as string, /^[^\n]+\.$/, "one sentence, on one line");
    });

    test("lists one plugin: jig, read from the package root, at the package version", () => {
        const plugins = marketplace.plugins as Json[];
        assert.equal(plugins.length, 1);
        const [entry] = plugins as [Json];
        assert.equal(entry.name, json(PLUGIN_FILE).name, "the name the plugin file gives");
        assert.equal(entry.name, CLAUDE_PLUGIN);
        assert.equal(entry.source, "./");
        assert.equal(entry.version, packageVersion());
        assert.equal(typeof entry.description, "string");
        assert.notEqual(entry.description, "");
        assert.equal(
            existsSync(path.join(ROOT, entry.source as string, ".claude-plugin/plugin.json")),
            true,
            "the source holds the plugin",
        );
    });
});

/** What the gateway lists for each tool: its actions, and every word the skill may put in code type under it (actions, parameters, parameter values). */
interface Form {
    actions: string[];
    words: Set<string>;
}

function forms(): Map<string, Form> {
    const list = JSON.parse(readFileSync(TOOLS_FILE, "utf8")) as Array<{
        name: string;
        inputSchema: { properties: Record<string, { enum?: unknown[] }> };
    }>;
    const out = new Map<string, Form>();
    for (const tool of list) {
        const properties = tool.inputSchema.properties;
        const actions = (properties.action?.enum ?? []) as string[];
        const values = Object.values(properties).flatMap((property) => (property.enum ?? []).map(String));
        out.set(tool.name, { actions, words: new Set([...actions, ...Object.keys(properties), ...values]) });
    }
    return out;
}

/** The read actions, which the skill must list for each tool. A new read action is a decision, so it is written here. */
const READS: Record<string, string[]> = {
    pr: ["view", "list", "comments"],
    release: ["tags", "releases"],
    jig: ["status"],
};

/** What a plain word in code type may be that is not an action or a parameter. */
const OTHER_WORDS = new Set(["pr", "release", "jig", "origin", "gh", "glab"]);

/** The reasons the skill text is wrong for an agent that is not Pi, one line each. Empty when it is right. */
function skillProblems(text: string, tools: Map<string, Form>): string[] {
    const problems: string[] = [];
    for (const banned of [/\bwatch\b/i, /tag_create/, /`git`/, /\bgit tool\b/i]) {
        if (banned.test(text)) problems.push(`names ${banned}, which is not offered here`);
    }
    const everything = new Set([...tools.values()].flatMap((form) => [...form.words]));
    // One section for each `## ` heading. A section about one of Jig's tools may use that tool's words; any other may use the words of any tool.
    for (const section of text.split(/^## /m).slice(1)) {
        const heading = section.split("\n")[0] ?? "";
        const tool = /^Jig's (\w+) tool$/.exec(heading)?.[1];
        const form = tool === undefined ? undefined : tools.get(tool);
        const body = section.replace(/```[\s\S]*?```/g, "");
        const named = new Set([...body.matchAll(/`([a-z][a-z_]*)`/g)].map((match) => match[1] as string));
        for (const word of named) {
            if (!(form?.words ?? everything).has(word) && !OTHER_WORDS.has(word)) {
                problems.push(`"${heading}" names \`${word}\`, which ${tool ?? "no tool"} does not list`);
            }
        }
        if (tool !== undefined && form !== undefined) {
            for (const action of form.actions)
                if (!named.has(action)) problems.push(`"${heading}" does not name the action \`${action}\``);
            for (const read of READS[tool] ?? [])
                if (!named.has(read)) problems.push(`"${heading}" does not list the read \`${read}\``);
        }
    }
    for (const tool of tools.keys()) {
        if (!text.includes(`Jig's ${tool} tool`)) problems.push(`never says "Jig's ${tool} tool"`);
    }
    return problems;
}

describe("the skill, adapters/claude-code/skills/git/SKILL.md", () => {
    const text = readFileSync(SKILL_FILE, "utf8");

    test("has a name, git, and a description that says when to use it", () => {
        const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
        assert.match(front, /^name: git$/m);
        const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
        for (const word of [/pull requests/i, /merge requests/, /tags/, /releases/, /GitHub/, /GitLab/, /Use it/])
            assert.match(description, word);
    });

    test("names only actions that dist/tools.json lists for the tool, and all of them, with the reads", () => {
        assert.deepEqual(skillProblems(text, forms()), []);
    });

    test("is not Pi's skill: it names no watch, no tag_create and no git tool, and says what the tools are called", () => {
        assert.doesNotMatch(text, /\bwatch\b/i);
        assert.doesNotMatch(text, /tag_create/);
        assert.doesNotMatch(text, /`git`|\bgit tool\b/i);
        for (const tool of ["pr", "release", "jig"]) assert.match(text, new RegExp(`Jig's ${tool} tool`));
        assert.doesNotMatch(text, /mcp__/, "the full name differs by agent, so the skill gives none");
    });

    test("tells the model what a refused write is, and what to do: say so, do not repeat, do not go round", () => {
        assert.ok(text.includes(NO_SCREEN), "the line the gateway says");
        assert.match(text, /tell the user the call was refused and why/i);
        assert.match(text, /Do not repeat the call/);
        assert.match(
            text,
            /Do not make the same change another\s+way, with `gh` or `glab` in the shell, unless the user asks you to/,
        );
    });

    test("says to use the shell for git itself, to give dir and repo, to read status, and never to start a sign-in", () => {
        assert.match(text, /Git itself \(status, diff, commit, branch, push\)[\s\S]*Use the shell/);
        assert.match(text, /give `dir`: the\s+absolute path/);
        assert.match(text, /`repo` names another repository of the workspace/);
        assert.match(text, /`status`: what Jig decided lately/);
        assert.match(text, /tell the user to sign in\. Never start a sign-in yourself/);
    });

    test("is shorter than Pi's own git skill", () => {
        const lines = (file: string): number => readFileSync(file, "utf8").split("\n").length;
        assert.ok(
            lines(SKILL_FILE) < lines(PI_SKILL_FILE),
            `${lines(SKILL_FILE)} lines against ${lines(PI_SKILL_FILE)}`,
        );
    });

    test("the check itself fails on an action tools.json does not list, on watch, on tag_create, on a git tool, and on a missing read", () => {
        const tools = forms();
        const wrong = (change: (from: string) => string): string[] => skillProblems(change(text), tools);
        assert.match(
            wrong((from) => from.replace("`merge`.", "`merge` and `frobnicate`.")).join("\n"),
            /names `frobnicate`, which pr does not list/,
        );
        assert.match(wrong((from) => from.replace("`tag_push`", "`tag_create`, `tag_push`")).join("\n"), /tag_create/);
        assert.match(wrong((from) => `${from}\nStart a \`watch\` on it.\n`).join("\n"), /watch/);
        assert.match(wrong((from) => `${from}\nUse the \`git\` tool to commit.\n`).join("\n"), /`git`/);
        assert.match(
            wrong((from) => from.replace("- `releases`:", "- `tags`:")).join("\n"),
            /does not list the read `releases`/,
        );
        assert.match(wrong((from) => from.replace("`resolve`", "`close`")).join("\n"), /names `close`/);
        assert.match(
            wrong((from) => from.replaceAll("Jig's release tool", "the release tool")).join("\n"),
            /never says "Jig's release tool"/,
        );
    });
});

// Every skill that an adapter ships, held to the rules that agents apply when they read a SKILL.md. The skill above is checked for its words; these
// checks are about the file itself, and cover a second skill when one is added. An agent that finds a skill it does not accept drops it, and says little.

/** The keys a SKILL.md may have in its frontmatter. Two sources: the Agent Skills specification (agentskills.io/specification) gives name, description,
 *  license, compatibility, metadata and allowed-tools; Claude Code's own keys come from its skills documentation (code.claude.com/docs/en/skills) and
 *  are the ones its 2.1.332 binary reads. Any other key is a typo or a key no agent reads, so a new one is added here on purpose. */
const SKILL_KEYS = new Set([
    // The Agent Skills specification.
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    // Claude Code's own.
    "when_to_use",
    "argument-hint",
    "arguments",
    "disable-model-invocation",
    "user-invocable",
    "model",
    "effort",
    "shell",
    "hooks",
    "context",
    "agent",
    "paths",
]);

/** Kebab-case: lower-case letters and digits in words that one hyphen joins, as the Agent Skills specification asks. */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The limits of the Agent Skills specification (name, description), and of Claude Code (description with when_to_use, in the list of skills). */
const NAME_LIMIT = 64;
const DESCRIPTION_LIMIT = 1024;
const LISTING_LIMIT = 1536;

/** The skills of every adapter: the folder's name, and the file. */
function skillFolders(): Array<{ adapter: string; folder: string; file: string }> {
    const adapters = path.join(ROOT, "adapters");
    const folders = (parent: string): string[] =>
        existsSync(parent)
            ? readdirSync(parent, { withFileTypes: true })
                  .filter((entry) => entry.isDirectory())
                  .map((entry) => entry.name)
            : [];
    return folders(adapters).flatMap((adapter) =>
        folders(path.join(adapters, adapter, "skills")).map((folder) => ({
            adapter,
            folder,
            file: path.join(adapters, adapter, "skills", folder, "SKILL.md"),
        })),
    );
}

/** The frontmatter of a SKILL.md as the yaml package reads it, or undefined when there is none or it is not a map. */
function frontmatterOf(text: string): Record<string, unknown> | undefined {
    const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1];
    if (front === undefined) return undefined;
    const parsed: unknown = parse(front);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
}

/** The reasons the frontmatter of the skill in `folder` is wrong, one line each. Empty when it is right. */
function frontmatterProblems(folder: string, front: Record<string, unknown> | undefined): string[] {
    if (front === undefined) return ["has no frontmatter that is a map"];
    const problems: string[] = [];
    const { name, description, when_to_use: when } = front;
    if (name !== folder) problems.push(`name is ${JSON.stringify(name)}, not the folder name ${folder}`);
    if (typeof name !== "string" || !KEBAB_CASE.test(name)) problems.push("name is not kebab-case");
    if (typeof name === "string" && name.length > NAME_LIMIT) problems.push(`name is longer than ${NAME_LIMIT}`);
    if (typeof description !== "string" || description.trim() === "") problems.push("description is empty");
    if (typeof description === "string" && description.length > DESCRIPTION_LIMIT)
        problems.push(`description is longer than ${DESCRIPTION_LIMIT}`);
    if (when !== undefined && typeof when !== "string") problems.push("when_to_use is not text");
    const listed = [description, when].reduce<number>(
        (sum, one) => sum + (typeof one === "string" ? one.length : 0),
        0,
    );
    if (listed > LISTING_LIMIT) problems.push(`description and when_to_use together are longer than ${LISTING_LIMIT}`);
    for (const key of Object.keys(front)) {
        if (!SKILL_KEYS.has(key)) problems.push(`the key ${key} is not one that an agent reads`);
    }
    return problems;
}

describe("every skill of every adapter", () => {
    const skills = skillFolders();

    test("there is at least the git skill, and each folder holds a SKILL.md", () => {
        assert.ok(skills.some((skill) => skill.adapter === "claude-code" && skill.folder === "git"));
        for (const skill of skills) assert.equal(existsSync(skill.file), true, `${skill.file} is missing`);
    });

    for (const skill of skills) {
        test(`adapters/${skill.adapter}/skills/${skill.folder}: the frontmatter is one an agent accepts`, () => {
            assert.deepEqual(frontmatterProblems(skill.folder, frontmatterOf(readFileSync(skill.file, "utf8"))), []);
        });
    }

    test("the check itself fails on another name, a name that is not kebab-case or is too long, an empty or long description, and a key nobody reads", () => {
        const good = { name: "git", description: "Pull requests." };
        const wrong = (change: Record<string, unknown>, folder = "git"): string =>
            frontmatterProblems(folder, { ...good, ...change }).join("\n");
        assert.deepEqual(frontmatterProblems("git", good), []);
        assert.match(wrong({}, "pull-requests"), /not the folder name pull-requests/);
        assert.match(wrong({ name: "Git" }, "Git"), /not kebab-case/);
        assert.match(wrong({ name: "git-" }, "git-"), /not kebab-case/);
        assert.match(wrong({ name: "git--hub" }, "git--hub"), /not kebab-case/);
        assert.match(wrong({ name: "a".repeat(65) }, "a".repeat(65)), /name is longer than 64/);
        assert.match(wrong({ description: "  " }), /description is empty/);
        assert.match(wrong({ description: undefined }), /description is empty/);
        assert.match(wrong({ description: "d".repeat(1025) }), /description is longer than 1024/);
        assert.equal(wrong({ description: "d".repeat(1024) }), "", "1024 is the limit, and allowed");
        assert.match(
            wrong({ description: "d".repeat(1000), when_to_use: "w".repeat(537) }),
            /together are longer than 1536/,
        );
        assert.equal(wrong({ description: "d".repeat(1000), when_to_use: "w".repeat(536) }), "");
        assert.match(wrong({ when_to_use: 3 }), /when_to_use is not text/);
        assert.match(wrong({ tools: "Bash" }), /the key tools is not one that an agent reads/);
        assert.match(frontmatterProblems("git", undefined).join("\n"), /no frontmatter/);
    });

    test("the frontmatter reader reads a map, and nothing else, and stops at YAML that an agent would refuse", () => {
        assert.deepEqual(frontmatterOf('---\nname: git\ndescription: "A: b"\n---\n# Body\n'), {
            name: "git",
            description: "A: b",
        });
        assert.equal(frontmatterOf("# No frontmatter\n"), undefined);
        assert.equal(frontmatterOf("---\n- a\n- b\n---\n"), undefined);
        // An unquoted colon in a description is a mistake that is easy to make, and the file is not YAML then.
        assert.throws(() => frontmatterOf("---\nname: git\ndescription: A: b\n---\n"), /Nested mappings/);
    });
});

// Claude Code puts a plugin's `bin/` folder at the end of the PATH of its shell tool, and has no setting that stops it. The package root is the plugin,
// so every executable file in the package's `bin/` is a command a model can run by name there. The list is pinned: a new program in `bin/` is a decision,
// and the gateway's document tells a person about each one.
describe("the package's bin/ folder, which Claude Code puts on its shell's PATH", () => {
    const BIN = path.join(ROOT, "bin");
    const EXPECTED = ["clipboard-copy", "jig-gateway.mjs", "jig.mjs", "pi"];

    // Windows keeps no executable bit, so there is nothing to read there.
    test("holds exactly these executable files", { skip: process.platform === "win32" }, () => {
        const executable = readdirSync(BIN)
            .filter((name) => (statSync(path.join(BIN, name)).mode & 0o111) !== 0)
            .sort();
        assert.deepEqual(executable, EXPECTED);
    });

    test("each of them is named in the gateway's document, where it says what the plugin adds", () => {
        const document = readFileSync(path.join(ROOT, "plugins/jig-core/docs/gateway.md"), "utf8");
        const line = document.split("\n").find((one) => one.includes("programs in Claude Code's shell")) ?? "";
        for (const name of EXPECTED) assert.equal(line.includes(`\`${name}\``), true, name);
    });
});

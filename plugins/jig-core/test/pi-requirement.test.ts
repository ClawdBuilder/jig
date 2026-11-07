// The Pi version a release states is one fact in six places: `jig.agents.pi` in package.json, the two CI Install Pi steps,
// the README sentence and compatibility table, the AGENTS.md test command, and the exact devDependencies. They move together.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { piRequirement } from "../src/pi-version.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

function read(file: string): string {
    return readFileSync(path.join(ROOT, file), "utf8");
}

describe("the Pi requirement", () => {
    test("is the minimum and tested version the package states", () => {
        assert.deepEqual(piRequirement(), { minimum: "1.4.0", tested: "1.5.0" });
    });

    test("names the tested version everywhere AGENTS.md says it is named", () => {
        const requirement = piRequirement();
        assert.ok(requirement);
        const tested = requirement.tested;
        const ci = read(".github/workflows/ci.yml");
        assert.equal(
            [...ci.matchAll(/npm install -g @earendil-works\/pi-coding-agent@(\d+\.\d+\.\d+)/g)].length,
            2,
            "both Install Pi steps",
        );
        for (const match of ci.matchAll(/npm install -g @earendil-works\/pi-coding-agent@(\d+\.\d+\.\d+)/g)) {
            assert.equal(match[1], tested);
        }
        assert.match(read("AGENTS.md"), new RegExp(`pi-coding-agent@${tested.replaceAll(".", "\\.")}`));
        const manifest = JSON.parse(read("package.json")) as {
            devDependencies: Record<string, string>;
        };
        assert.equal(manifest.devDependencies["@earendil-works/pi-coding-agent"], tested);
        assert.equal(manifest.devDependencies["@earendil-works/pi-ai"], tested);
        assert.equal(manifest.devDependencies["@earendil-works/pi-tui"], tested);
        assert.match(read("README.md"), new RegExp(`tested with ${tested.replaceAll(".", "\\.")}`, "i"));
        assert.match(read("docs/compatibility.md"), new RegExp(`\\| ${tested.replaceAll(".", "\\.")} \\|`));
    });

    test("the README's stated minimum is the package's minimum", () => {
        const requirement = piRequirement();
        assert.ok(requirement);
        const majorMinor = requirement.minimum.split(".").slice(0, 2).join(".");
        assert.match(read("README.md"), new RegExp(`Jig needs Pi ${majorMinor.replaceAll(".", "\\.")} or later`));
    });
});

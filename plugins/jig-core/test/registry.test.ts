// The registry `jig update` asks, and the same sources the notice reads without starting npm.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { DEFAULT_REGISTRY, normalizeRegistry, registryFor, registryInNpmrc, registryUrl } from "../src/registry.ts";

let home: string;
let work: string;

beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "jig-registry-"));
    work = path.join(home, "work");
    mkdirSync(work);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("normalizeRegistry", () => {
    test("keeps an http(s) base with one trailing slash", () => {
        assert.equal(normalizeRegistry("https://registry.npmjs.org"), "https://registry.npmjs.org/");
        assert.equal(normalizeRegistry("https://mirror.example/npm//"), "https://mirror.example/npm/");
        assert.equal(normalizeRegistry("ftp://mirror.example"), undefined);
        assert.equal(normalizeRegistry("not a URL"), undefined);
        assert.equal(normalizeRegistry(""), undefined);
    });
});

describe("registryFor", () => {
    test("env wins, then the project .npmrc, then the user's", () => {
        writeFileSync(path.join(home, ".npmrc"), "registry=https://user.example/\n");
        writeFileSync(path.join(work, ".npmrc"), "registry=https://project.example/\n");
        assert.equal(registryFor({ npm_config_registry: "https://env.example/" }, home, work), "https://env.example/");
        assert.equal(registryFor({}, home, work), "https://project.example/");
        rmSync(path.join(work, ".npmrc"));
        assert.equal(registryFor({}, home, work), "https://user.example/");
        rmSync(path.join(home, ".npmrc"));
        assert.equal(registryFor({}, home, work), DEFAULT_REGISTRY);
    });

    test("honours NPM_CONFIG_USERCONFIG and reads comments and quotes", () => {
        const userConfig = path.join(home, "custom.npmrc");
        writeFileSync(userConfig, '# comment\nregistry = "https://quoted.example/npm" ; trailing\n');
        assert.equal(registryFor({ NPM_CONFIG_USERCONFIG: userConfig }, home, work), "https://quoted.example/npm/");
        assert.equal(registryInNpmrc(path.join(home, "gone.npmrc")), undefined);
    });
});

describe("registryUrl", () => {
    test("escapes a scoped name's slash once, as npm does", () => {
        assert.equal(
            registryUrl("https://mirror.example/npm/", "@clawdbuilder/jig"),
            "https://mirror.example/npm/@clawdbuilder%2Fjig",
        );
        assert.equal(registryUrl("https://mirror.example", "plain"), "https://mirror.example/plain");
    });
});

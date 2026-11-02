// jig-ops' `deploy status` and `deploy plan` of a pin, reading a file of this repository at a fixed commit through the real `gh`
// and the real GitHub API, with the token Actions gives the run (`GH_TOKEN`). The fixed commit never changes, so what it holds
// never does: the version in `package.json`. Nothing is written, and the pin is read at a commit and not at a branch.
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { test } from "node:test";
import { describeIt, must, optional } from "../../../../test/support/it.ts";
import { ok } from "../support/harness.ts";
import type { Harness } from "../support/harness.ts";
import { realHarness } from "../support/real.ts";
import type { Raw } from "../support/section.ts";

/** A commit of this repository's history and the version `package.json` holds in it. */
const COMMIT = "966343b179bd6b0da4a38aed19c378f09e513528";
const VERSION = "0.2.0";

describeIt(
    "jig-ops pins against GitHub",
    {
        service: "github",
        variables: ["JIG_IT_GITHUB_REPOSITORY"],
        hint: "gh signed in (GH_TOKEN) and the repository as owner/name, whose history holds the fixed commit",
    },
    () => {
        const section = (): Raw => ({
            services: {
                jig: {
                    environments: {
                        production: {
                            pinned: {
                                repo: must("JIG_IT_GITHUB_REPOSITORY"),
                                base: COMMIT,
                                pins: [{ file: "package.json", line: '^ {4}"version": "(?<version>[^"]+)",$' }],
                                version: "^\\d+\\.\\d+\\.\\d+$",
                            },
                        },
                    },
                },
            },
        });
        const harness = (t: TestContext): Harness => {
            const token = optional("GH_TOKEN");
            return realHarness(t, section(), token === undefined ? {} : { GH_TOKEN: token });
        };

        test("status reads the line of a file at a commit, and who changed the file last", async (t) => {
            const h = harness(t);
            const result = await h.deploy.call({ action: "status", service: "jig", environment: "production" });
            const text = ok(result);
            assert.deepEqual(result.cls, { action: "status", environment: "production", effect: "read" });
            assert.match(
                text,
                new RegExp(
                    `^jig\\n- production: ${COMMIT} pins ${VERSION.replace(/\./g, "\\.")}, changed by .+ \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC`,
                ),
            );
        });

        test("plan says a run would be refused in production, and what the commit pins", async (t) => {
            const h = harness(t);
            const text = ok(
                await h.deploy.call({ action: "plan", service: "jig", environment: "production", version: "9.9.9" }),
            );
            assert.match(text, /A deploy run would be refused: jig in production is production/);
            assert.match(text, new RegExp(`Pinned now: ${COMMIT} pins ${VERSION.replace(/\./g, "\\.")},`));
        });

        test("a file that is not there is said, and not an error", async (t) => {
            const h = harness(t);
            h.configure({
                services: {
                    jig: {
                        environments: {
                            production: {
                                pinned: {
                                    repo: must("JIG_IT_GITHUB_REPOSITORY"),
                                    base: COMMIT,
                                    pins: [{ file: "no/such/file.txt", line: "^(?<version>\\S+)$" }],
                                },
                            },
                        },
                    },
                },
            });
            const text = ok(await h.deploy.call({ action: "status", service: "jig", environment: "production" }));
            assert.match(text, /the pin could not be read: no\/such\/file\.txt in .+ on 966343b.* was not found/);
        });
    },
);

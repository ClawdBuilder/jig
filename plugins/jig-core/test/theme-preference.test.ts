import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { agentDirFor } from "../src/kit/theme-preference.ts";

test("the kit's agent folder follows Pi's rule exactly", () => {
    const saved = process.env.PI_CODING_AGENT_DIR;
    try {
        for (const value of ["~/x", path.join(homedir(), "abs"), "", undefined, " /x "]) {
            if (value === undefined) delete process.env.PI_CODING_AGENT_DIR;
            else process.env.PI_CODING_AGENT_DIR = value;
            assert.equal(agentDirFor(), getAgentDir(), `${String(value)}`);
        }
    } finally {
        if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = saved;
    }
});

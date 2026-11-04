// jig-git: git, GitHub and GitLab for the agent. Three tools, `git`, `pr` and `release`. The tools only say what each call does;
// jig-core decides whether it runs, and asks the user. CI (checks, runs, logs and watches) is the `ci` tool of jig-ops: after a
// push or a new pull request this plugin announces `jig-git:pushed` on Pi's event bus, and jig-ops acts on it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { validateGitSection } from "./config.ts";
import { setAnnouncer } from "./events.ts";
import { createFetchGuard } from "./fetch-guard.ts";
import { gitTool } from "./git.ts";
import { prTool } from "./pr.ts";
import { registerCommentWatch } from "./pr-watch.ts";
import { releaseTool } from "./release.ts";
import { setWorkingDirectory } from "./repo.ts";
import type { JigTool } from "./tool.ts";

const tools: JigTool[] = [gitTool, prTool, releaseTool];

export default function (pi: ExtensionAPI) {
    // A fetch offers the user's ssh key to the remote's host, and the host comes from a configuration the agent can write:
    // this gate asks about one the user's own configuration does not name as a forge.
    const fetchGuard = createFetchGuard(pi);
    // The tools' previews run without a context, so the folder Pi works in is remembered from the start of the session.
    pi.on("session_start", (_event, ctx) => setWorkingDirectory(ctx.cwd));
    pi.on("session_shutdown", () => fetchGuard.stop());
    setAnnouncer((event, payload) => pi.events.emit(event, payload));
    for (const tool of tools) registerJigTool(pi, tool.definition);
    // jig-core may load after this plugin; withJig waits for it. What the tools declare is how jig-core classifies them.
    withJig((api) => {
        for (const tool of tools) api.declareTool(tool.declaration);
        api.config.registerSection("git", validateGitSection);
        api.gates.register(fetchGuard.gate);
        // The comments of a pull request are watched in the background, and the agent is told in one message per poll.
        registerCommentWatch(api);
    });
}

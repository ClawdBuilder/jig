// jig-git: git, GitHub and GitLab for the agent. Three tools, `git`, `pr` and `release`. The tools only say what each call does;
// jig-core decides whether it runs, and asks the user. CI (checks, runs, logs and watches) is the `ci` tool of jig-ops: after a
// push or a new pull request this plugin announces `jig-git:pushed` on Pi's event bus, and jig-ops acts on it.
// This is the entry for Pi. `pr` and `release` are `EngineTool` objects, which `connector.ts` hands to an agent that is not Pi as well; the
// `git` tool, the two gates and the comment watch are Pi's alone.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withJig } from "../../jig-core/src/client.ts";
import { registerEngineTool, registerJigTool } from "../../jig-core/src/kit/tools.ts";
import { registerGitSection } from "./config.ts";
import { setAnnouncer } from "./events.ts";
import { createFetchGuard } from "./fetch-guard.ts";
import { gitTool } from "./git.ts";
import { runsLaterGate } from "./runs-later-gate.ts";
import { prTool } from "./pr.ts";
import { registerCommentWatch } from "./pr-watch.ts";
import { releaseTool } from "./release.ts";
import { setWorkingDirectory } from "./repo.ts";

export default function (pi: ExtensionAPI) {
    // A fetch offers the user's ssh key to the remote's host, and the host comes from a configuration the agent can write:
    // this gate asks about one the user's own configuration does not name as a forge.
    const fetchGuard = createFetchGuard(pi);
    // The tools' previews run without a context, so the folder Pi works in is remembered from the start of the session.
    pi.on("session_start", (_event, ctx) => setWorkingDirectory(ctx.cwd));
    pi.on("session_shutdown", () => fetchGuard.stop());
    setAnnouncer((event, payload) => pi.events.emit(event, payload));
    registerJigTool(pi, gitTool.definition);
    registerEngineTool(pi, prTool);
    registerEngineTool(pi, releaseTool);
    // jig-core may load after this plugin; withJig waits for it. What the tools declare is how jig-core classifies them.
    withJig((api) => {
        api.declareTool(gitTool.declaration);
        // An `EngineTool` is a declaration too.
        api.declareTool(prTool);
        api.declareTool(releaseTool);
        registerGitSection(api);
        api.gates.register(fetchGuard.gate);
        api.gates.register(runsLaterGate);
        // The comments of a pull request are watched in the background, and the agent is told in one message per poll.
        registerCommentWatch(api);
    });
}

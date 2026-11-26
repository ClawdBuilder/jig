// The entry of jig-git for an agent that is not Pi (a gateway): the tools it offers there, and what it registers with the engine. Pi
// loads `index.ts` instead. Both read the same `prTool` and `releaseTool` objects and call the same `registerGitSection`, so a tool and
// the `git` section are declared once. The `git` tool, its two gates and the comment watch stay in Pi's entry: they guard Pi's own
// `git` tool and need Pi's events.
// This file and every file it imports at run time load with no Pi package. A type from the kit comes in with `import type`, because
// `kit/tools.ts` itself imports Pi.
import type { ConnectorModule } from "../../jig-core/src/kit/tools.ts";
import { registerGitSection } from "./config.ts";
import { prTool } from "./pr.ts";
import { releaseTool } from "./release.ts";

const connector: ConnectorModule = {
    name: "jig-git",
    tools: [prTool, releaseTool],
    // Both are local writes, which the engine runs with no question, so a gateway that cannot ask keeps them out until it can: `release
    // tag_create` and `pr watch` (the comment watch needs an agent that can be told about a comment).
    notOffered: { pr: ["watch"], release: ["tag_create"] },
    register: registerGitSection,
};

export default connector;

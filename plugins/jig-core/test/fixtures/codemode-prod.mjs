// A tool that jig-core classifies as a production read, so a codemode script can prove that masking still happens before
// the script sees the result.
import { withJig } from "../../src/client.ts";
import { Type } from "typebox";

export default function (pi) {
    withJig((api) => {
        api.declareTool({
            tool: "prod_read_tool",
            plugin: "jig-test",
            classify: () => ({ environment: "production", effect: "read" }),
        });
    });
    pi.registerTool({
        name: "prod_read_tool",
        label: "Production read",
        description: "Returns production personal data, for the masking test.",
        parameters: Type.Object({}),
        async execute() {
            return {
                content: [{ type: "text", text: "account 123 email jane@example.com phone +1 415 555 0100" }],
                details: {},
            };
        },
    });
}

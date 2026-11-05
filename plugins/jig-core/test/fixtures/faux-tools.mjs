// A model that makes exactly the tool calls PROBE_TOOLS names, so a test can drive Pi's real file and bash tools.
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";

export default function (pi) {
    const faux = fauxProvider({
        provider: "faux",
        models: [{ id: "faux-1", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    const calls = JSON.parse(process.env.PROBE_TOOLS ?? "[]");
    faux.setResponses([
        () =>
            fauxAssistantMessage(
                calls.map((one) => fauxToolCall(one.tool, one.args)),
                { stopReason: "toolUse" },
            ),
        () => fauxAssistantMessage("done"),
    ]);
    pi.registerProvider(faux.provider);
}

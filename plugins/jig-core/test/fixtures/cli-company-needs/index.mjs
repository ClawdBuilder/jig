// A company plugin for the CLI tests: a required field its validator checks, a required field only its onboarding list
// names, and an optional one.
import { withJig } from "../../../src/client.ts";

export default function fixtureNeeds() {
    withJig((api) => {
        const scoped = api.profiles.register("needs-co", { displayName: "Needs Co" });
        scoped.config.registerSection("fixture", (raw) =>
            typeof raw?.login === "string" && raw.login !== "" ? [] : ["fixture.login is required"],
        );
        scoped.onboarding.register({
            items: [
                { kind: "text", section: "fixture", path: "login", label: "Your Fixture login" },
                { kind: "text", section: "fixture", path: "badge", label: "Your Fixture badge" },
                { kind: "text", section: "fixture", path: "note", label: "Your Fixture note", optional: true },
            ],
        });
    });
}

// A company plugin for the CLI tests: two items, each proposing the login name the machine already has.
import { withJig } from "../../../src/client.ts";

export default function detectCompany() {
    withJig((api) => {
        const scoped = api.profiles.register("detect-co", { displayName: "Detect Co" });
        scoped.config.registerSection("fixture", (raw) =>
            typeof raw?.login === "string" && /^[a-z][a-z0-9-]*$/.test(raw.login)
                ? []
                : ["fixture.login must start with a lowercase letter"],
        );
        scoped.onboarding.register({
            items: [
                { kind: "text", section: "fixture", path: "login", label: "Your Fixture login", detect: "user" },
                {
                    kind: "pick",
                    section: "fixture",
                    path: "team",
                    label: "Your Fixture team",
                    choices: ["orders", "jdoe"],
                    detect: "user",
                },
            ],
        });
    });
}

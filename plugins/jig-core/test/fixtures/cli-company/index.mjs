// A company plugin for the CLI tests: one section, one default, one onboarding item.
import { withJig } from "../../../src/client.ts";

export default function fixtureCompany() {
    withJig((api) => {
        const scoped = api.profiles.register("fixture-co", { displayName: "Fixture Co" });
        scoped.config.registerSection("fixture", (raw) =>
            typeof raw?.login === "string" && raw.login !== "" ? [] : ["fixture.login is required"],
        );
        scoped.config.addSectionDefaults("fixture", { site: "https://fixture.example" });
        scoped.onboarding.register({
            items: [
                { kind: "text", section: "fixture", path: "login", label: "Your Fixture login", placeholder: "jdoe" },
            ],
        });
    });
}

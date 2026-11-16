// A company plugin for the CLI tests: one proposed start check, which --yes must not add.
import { withJig } from "../../../src/client.ts";

export default function fixtureCompany() {
    withJig((api) => {
        const scoped = api.profiles.register("proposal-co", { displayName: "Proposal Co" });
        scoped.onboarding.register({
            items: [
                {
                    kind: "proposal",
                    section: "startChecks",
                    value: { name: "VPN", tcp: "vpn.example.com:443" },
                    label: "A check that the VPN is up",
                    why: "The tools need it.",
                },
            ],
        });
    });
}

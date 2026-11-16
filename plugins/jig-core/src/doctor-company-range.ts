// The doctor's company Jig-range check: an installed company package may cap which Jig release its people may run.
// Inside the range there is nothing to say; outside it, the line names the package, the range and this Jig.
import { companyRanges } from "./update-company.ts";
import { parseRange } from "./update-versions.ts";
import { jigPackage } from "./pi-version.ts";
import { readPackages } from "./cli/packages.ts";
import type { DoctorContext, DoctorLine, DoctorOptions } from "./doctor.ts";

export function companyRangeChecks(context: DoctorContext, options: DoctorOptions): DoctorLine[] {
    const current = options.jigVersion === null ? undefined : (options.jigVersion ?? jigPackage().version);
    if (current === undefined || context.agentDir === "") return [];
    const listed = readPackages(context.agentDir, context.workingDir).listed;
    const lines: DoctorLine[] = [];
    for (const company of companyRanges(listed, jigPackage().name ?? "")) {
        const check = parseRange(company.range);
        if (check === undefined) {
            lines.push({
                id: `config.company-range.${company.package}`,
                group: "config",
                level: "warn",
                title: `Company Jig range — ${company.package}`,
                detail: `${company.package} states a Jig range this doctor cannot read: ${company.range}.`,
                fix: `Ask for a ${company.package} package with a readable Jig range.`,
            });
            continue;
        }
        if (check(current)) continue;
        lines.push({
            id: `config.company-range.${company.package}`,
            group: "config",
            level: "warn",
            title: `Company Jig range — ${company.package}`,
            detail: `${company.package} allows ${company.range}; this Jig is ${current}.`,
            fix: `Run jig update, or ask for a ${company.package} package that fits Jig ${current}.`,
        });
    }
    return lines;
}

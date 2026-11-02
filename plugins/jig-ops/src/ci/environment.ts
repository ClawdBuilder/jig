// The environment a `ci` call acts in, when the call names one: how a preview and a watch's title say so. A call that names
// an environment uses that environment's CI job, and the rules of that environment apply to it (see tool.ts).
import { jig } from "../../../jig-core/src/client.ts";
import type { CiService } from "../catalog.ts";

/** `staging (test)`: the environment and the kind jig-core knows it as. Undefined for a call that names none. */
export function environmentOf(service: CiService): string | undefined {
    return service.environment === undefined
        ? undefined
        : `${service.environment} (${jig().environments.kindOf(service.environment)})`;
}

/** ` in staging` after a headline, or nothing. */
export function inEnvironment(service: CiService): string {
    return service.environment === undefined ? "" : ` in ${service.environment}`;
}

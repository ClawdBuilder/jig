// The deploy methods there are, in one place: the catalog checks an environment's `deploy` object with checkDeploy, and
// the deploy tool turns it into a Deployer with deployerOf. A new method (a GitOps pull request, a CI deploy job) is a
// file beside helm.ts, a case in each of the two functions below, and its name in METHODS.
import { isObject } from "../values.ts";
import type { Deployer } from "./command.ts";
import { checkHelm, helmDeployer } from "./helm.ts";
import type { HelmDeploy } from "./helm.ts";
import { checkKubectlImage, kubectlImageDeployer } from "./kubectl-image.ts";
import type { KubectlImageDeploy } from "./kubectl-image.ts";
import { checkPin } from "./pin-config.ts";
import type { PinDeploy } from "./pin-config.ts";

/** A method that changes a cluster by a command, and the pin method, which changes a version line in a repository. */
export type DeployConfig = HelmDeploy | KubectlImageDeploy | PinDeploy;
export type CommandDeploy = HelmDeploy | KubectlImageDeploy;

export const METHODS = ["helm", "kubectl-image", "pin"] as const;

/** Checks the `deploy` object of an environment and reads it, or adds the problems to `errors`. */
export function checkDeploy(raw: unknown, at: string, errors: string[]): DeployConfig | undefined {
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with a method: ${METHODS.join(" or ")}`);
        return undefined;
    }
    switch (raw.method) {
        case "helm":
            return checkHelm(raw, at, errors);
        case "kubectl-image":
            return checkKubectlImage(raw, at, errors);
        case "pin":
            return checkPin(raw, at, errors);
        case undefined:
            errors.push(`${at}.method: required, ${METHODS.join(" or ")}`);
            return undefined;
        default:
            errors.push(`${at}.method: must be ${METHODS.join(" or ")}`);
            return undefined;
    }
}

/** The deployer of a method that runs a command. A pin has none: it changes a line of a repository. */
export function deployerOf(config: CommandDeploy): Deployer {
    switch (config.method) {
        case "helm":
            return helmDeployer(config);
        case "kubectl-image":
            return kubectlImageDeployer(config);
    }
}

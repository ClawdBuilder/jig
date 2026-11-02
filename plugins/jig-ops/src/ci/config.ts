// The `ci` entry of a service in the catalog: which CI system builds the service and what to look at in it. Each system
// has its own fields, and a closed list of systems: a new adapter is a file beside this one and a name in CI_SYSTEMS.
//
//   { "system": "github-actions", "workflow": "build.yml" }
//   { "system": "gitlab", "url": "https://gitlab.example.com", "project": "acme/orders-api",
//     "auth": { "token": "pass:ci/gitlab" } }
//   { "system": "jenkins", "url": "https://jenkins.example.com", "job": "orders/build",
//     "auth": { "user": "ci-bot", "token": "pass:ci/jenkins" } }
//   { "system": "concourse", "url": "https://ci.example.com", "team": "main", "pipeline": "deploy",
//     "job": "orders-api-staging", "auth": { "token": "cmd:fly-main" }, "signInHint": "fly -t main login" }
//
// A credential is only ever a reference to a secret. An error about it never repeats the value: a mistake there may
// well be the secret itself, pasted by hand.
import { isObject, shown } from "../values.ts";

export const CI_SYSTEMS = ["github-actions", "gitlab", "jenkins", "concourse"] as const;
export type CiSystem = (typeof CI_SYSTEMS)[number];

/** How a request to a CI server signs in. A secret is a reference, resolved when the request is made. */
export type CiAuth =
    /** GitLab: a token sent in the `PRIVATE-TOKEN` header. Concourse: a token sent as a bearer. */
    | { kind: "token"; token: string }
    /** Jenkins: a user and an API token, sent with HTTP basic authentication. */
    | { kind: "basic"; user: string; token: string }
    /** A sign-in service a company plugin registered with jig-core, which supplies the headers of each request. */
    | { kind: "signIn"; service: string }
    /** A transport a company plugin registered, which carries the whole request and signs it in itself. */
    | { kind: "transport"; transport: string };

interface Common {
    /** The jig-core environment the CI server is in. Without it, the CI host is `external`. */
    environment?: string;
}

export interface GithubActionsConfig extends Common {
    system: "github-actions";
    /** The workflow file whose runs `runs` lists, such as `build.yml`. Without it, the runs of every workflow. */
    workflow?: string;
}

export interface GitlabConfig extends Common {
    system: "gitlab";
    /** The address of the GitLab server, without a trailing slash. It may have a path (`https://host/gitlab`). */
    url: string;
    /** A numeric project id, or the path with its namespace, such as `acme/orders-api`. */
    project: string;
    auth: CiAuth;
    /** Jobs that must pass for a `required` watch. Without any, the whole pipeline is watched. */
    required: readonly string[];
}

export interface JenkinsConfig extends Common {
    system: "jenkins";
    url: string;
    /** The job, with its folders: `orders/build` is the job `build` in the folder `orders`. */
    job: string;
    auth: CiAuth;
    /** Pipeline stages that must pass for a `required` watch. Without any, the whole build is watched. */
    required: readonly string[];
}

export interface ConcourseConfig extends Common {
    system: "concourse";
    url: string;
    team: string;
    pipeline: string;
    /** The job in that pipeline. A call never names it. */
    job: string;
    /** A token (sent as a bearer), a sign-in service or a transport. */
    auth: CiAuth;
    /** The command that renews the login, shown when Concourse refuses it. Jig never runs it. */
    signInHint?: string;
}

export type CiConfig = GithubActionsConfig | GitlabConfig | JenkinsConfig | ConcourseConfig;

const COMMON_FIELDS = ["system", "environment"];
const FIELDS: Readonly<Record<CiSystem, readonly string[]>> = {
    "github-actions": [...COMMON_FIELDS, "workflow"],
    gitlab: [...COMMON_FIELDS, "url", "project", "auth", "required"],
    jenkins: [...COMMON_FIELDS, "url", "job", "auth", "required"],
    concourse: [...COMMON_FIELDS, "url", "team", "pipeline", "job", "auth", "signInHint"],
};

const CONTROL = /[\u0000-\u001f\u007f]/;
const ENVIRONMENT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const WORKFLOW = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GITLAB_PROJECT = /^(?:\d{1,12}|[A-Za-z0-9_.-]{1,100}(?:\/[A-Za-z0-9_.-]{1,100}){1,19})$/;
/** Folders and a job, as Jenkins names them. A name may hold a space; it never starts with a dot. */
const JENKINS_JOB = /^[A-Za-z0-9_-][A-Za-z0-9 _.-]{0,99}(?:\/[A-Za-z0-9_-][A-Za-z0-9 _.-]{0,99}){0,9}$/;
/** A team, pipeline or job of Concourse. It becomes one part of a path, and never starts with a dot or a dash. */
const CONCOURSE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;
const MAX_HINT_CHARS = 200;
/** The shape of a secret reference (`pass:...`, `env:...`, `op://...`), without knowing which backends exist. */
const SECRET_REFERENCE = /^[a-z][a-z0-9+.-]*:\S+$/;
const SERVICE_NAME_CHARS = 100;
const MAX_REQUIRED = 20;
const MAX_URL_CHARS = 300;

/** The systems, for a message. */
export function systemList(): string {
    return CI_SYSTEMS.join(", ");
}

/** A key as a message may show it: plain when it is an ordinary name, quoted and cut when it is something else. */
function fieldName(key: string): string {
    return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) ? key : shown(key, 30);
}

function text(value: unknown, max: number): value is string {
    return typeof value === "string" && value !== "" && value.length <= max && !CONTROL.test(value);
}

/** The address of a CI server. A direct request carries a credential, so it is https; a transport signs in itself. */
function checkUrl(value: unknown, at: string, secure: boolean, errors: string[]): string | undefined {
    const example = "such as https://ci.example.com";
    if (typeof value !== "string" || value === "") {
        errors.push(`${at}: required, the address of the CI server, ${example}`);
        return undefined;
    }
    let url: URL;
    try {
        if (value.length > MAX_URL_CHARS || CONTROL.test(value)) throw new Error("not usable");
        url = new URL(value);
    } catch {
        errors.push(`${at}: must be an address ${example}`);
        return undefined;
    }
    // The address is never repeated below: a user name and password in it are credentials.
    if (url.protocol !== "https:" && (secure || url.protocol !== "http:")) {
        errors.push(
            `${at}: must start with ` +
                (secure ? "https://, because a credential travels with every request" : "http:// or https://"),
        );
        return undefined;
    }
    if (url.username !== "" || url.password !== "") {
        errors.push(`${at}: must not hold a user name or password: put them in auth`);
        return undefined;
    }
    if (url.search !== "" || url.hash !== "") {
        errors.push(`${at}: must not have a query string or a fragment`);
        return undefined;
    }
    // The request's path is added to this address, so it is kept as the parser reads it, without a trailing slash.
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function checkReference(value: unknown, at: string, errors: string[]): string | undefined {
    if (typeof value === "string" && value.length <= 500 && SECRET_REFERENCE.test(value)) return value;
    errors.push(`${at}: must be a secret reference such as pass:ci/token, never the secret itself`);
    return undefined;
}

function checkService(value: unknown, at: string, what: string, errors: string[]): string | undefined {
    if (typeof value === "string" && value.trim() === value && text(value, SERVICE_NAME_CHARS)) return value;
    errors.push(`${at}: must be the name of ${what}`);
    return undefined;
}

/**
 * The sign-in of a server. Exactly one of a token (with a `user` for Jenkins, which signs in with both), a sign-in
 * service and a transport. A transport signs the request in itself, so it takes no credential of ours.
 */
function checkAuth(raw: unknown, jenkins: boolean, at: string, errors: string[]): CiAuth | undefined {
    const choices = jenkins ? "user with token, signIn or transport" : "token, signIn or transport";
    if (raw === undefined) {
        errors.push(`${at}: required, one of ${choices}`);
        return undefined;
    }
    if (!isObject(raw)) {
        errors.push(`${at}: must be an object with one of ${choices}`);
        return undefined;
    }
    const before = errors.length;
    const known = jenkins ? ["user", "token", "signIn", "transport"] : ["token", "signIn", "transport"];
    for (const key of Object.keys(raw)) if (!known.includes(key)) errors.push(`${at}.${fieldName(key)}: unknown field`);
    const modes = [
        ...(raw.token !== undefined || raw.user !== undefined ? [jenkins ? "user with token" : "token"] : []),
        ...(raw.signIn !== undefined ? ["signIn"] : []),
        ...(raw.transport !== undefined ? ["transport"] : []),
    ];
    if (modes.length !== 1) {
        errors.push(`${at}: needs exactly one of ${choices} (found ${modes.length === 0 ? "none" : modes.join(", ")})`);
        return undefined;
    }
    if (errors.length > before) return undefined;
    if (raw.signIn !== undefined) {
        const service = checkService(raw.signIn, `${at}.signIn`, "a sign-in service", errors);
        return service === undefined ? undefined : { kind: "signIn", service };
    }
    if (raw.transport !== undefined) {
        const transport = checkService(raw.transport, `${at}.transport`, "a transport", errors);
        return transport === undefined ? undefined : { kind: "transport", transport };
    }
    const token = checkReference(raw.token, `${at}.token`, errors);
    if (!jenkins) return token === undefined ? undefined : { kind: "token", token };
    // A colon would end the user name early in the `user:token` that basic sign-in sends.
    const user = raw.user;
    if (typeof user !== "string" || !text(user, 100) || user.includes(":")) {
        errors.push(`${at}.user: required with token, a user name: text without a colon`);
        return undefined;
    }
    return token === undefined ? undefined : { kind: "basic", user, token };
}

/** A team, a pipeline or a job of Concourse, by its name. */
function checkConcourseName(value: unknown, at: string, what: string, errors: string[]): string | undefined {
    if (value === undefined) {
        errors.push(`${at}: required, the ${what} name`);
        return undefined;
    }
    if (typeof value === "string" && CONCOURSE_NAME.test(value)) return value;
    errors.push(`${at}: must be a ${what} name: letters, digits, . _ - (not starting with a dot or a dash)`);
    return undefined;
}

function checkRequired(raw: unknown, at: string, what: string, errors: string[]): readonly string[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > MAX_REQUIRED || !raw.every((item) => text(item, 200))) {
        errors.push(`${at}: must be a list of at most ${MAX_REQUIRED} ${what} names`);
        return [];
    }
    return raw as string[];
}

/** Whether the address is one a credential may be sent to: a transport carries its own, so it may be plain http. */
function secureUrl(auth: unknown): boolean {
    return !(isObject(auth) && auth.transport !== undefined);
}

/** The rest of a Concourse entry: the team, pipeline and job it names, and the hint for renewing the login. */
function checkConcourse(
    raw: Record<string, unknown>,
    at: string,
    more: { environment?: string },
    url: string | undefined,
    auth: CiAuth | undefined,
    before: number,
    errors: string[],
): ConcourseConfig | undefined {
    const team = checkConcourseName(raw.team, `${at}.team`, "team", errors);
    const pipeline = checkConcourseName(raw.pipeline, `${at}.pipeline`, "pipeline", errors);
    const job = checkConcourseName(raw.job, `${at}.job`, "job", errors);
    let signInHint: string | undefined;
    if (raw.signInHint !== undefined) {
        if (text(raw.signInHint, MAX_HINT_CHARS)) signInHint = raw.signInHint;
        else {
            errors.push(
                `${at}.signInHint: must be the command that renews the login, one line of at most ` +
                    `${MAX_HINT_CHARS} characters`,
            );
        }
    }
    if (errors.length > before || url === undefined || auth === undefined) return undefined;
    if (team === undefined || pipeline === undefined || job === undefined) return undefined;
    return {
        system: "concourse",
        ...more,
        url,
        team,
        pipeline,
        job,
        auth,
        ...(signInHint === undefined ? {} : { signInHint }),
    };
}

/**
 * Checks the `ci` entry of one service and reads it. Every error names its key; with any error there is no entry.
 * `repo` is the service's own, which GitHub Actions needs because the run is found by repository.
 */
export function checkCi(raw: unknown, at: string, repo: string | undefined, errors: string[]): CiConfig | undefined {
    if (!isObject(raw)) {
        errors.push(
            `${at}: must be an object with a system, such as { "system": "github-actions", "workflow": "build.yml" }`,
        );
        return undefined;
    }
    const system = raw.system;
    if (system === undefined) {
        errors.push(`${at}.system: required, the CI system: ${systemList()}`);
        return undefined;
    }
    if (typeof system !== "string" || !(CI_SYSTEMS as readonly string[]).includes(system)) {
        errors.push(`${at}.system: unknown CI system; the systems there are: ${systemList()}`);
        return undefined;
    }
    const kind = system as CiSystem;
    const before = errors.length;
    for (const key of Object.keys(raw)) {
        if (!FIELDS[kind].includes(key)) errors.push(`${at}.${fieldName(key)}: unknown field for ${kind}`);
    }
    let environment: string | undefined;
    if (raw.environment !== undefined) {
        if (typeof raw.environment === "string" && ENVIRONMENT_NAME.test(raw.environment))
            environment = raw.environment;
        else errors.push(`${at}.environment: must be the name of a jig-core environment, such as staging`);
    }
    const more = environment === undefined ? {} : { environment };

    if (kind === "github-actions") {
        if (repo === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
            errors.push(
                `${at}: github-actions finds runs by repository, so the service needs repo, such as acme/orders-api`,
            );
        }
        if (raw.workflow !== undefined && (typeof raw.workflow !== "string" || !WORKFLOW.test(raw.workflow))) {
            errors.push(`${at}.workflow: must be a workflow file name, such as build.yml`);
        }
        if (errors.length > before) return undefined;
        return { system: kind, ...more, ...(raw.workflow === undefined ? {} : { workflow: raw.workflow as string }) };
    }

    const url = checkUrl(raw.url, `${at}.url`, secureUrl(raw.auth), errors);
    const auth = checkAuth(raw.auth, kind === "jenkins", `${at}.auth`, errors);
    if (kind === "gitlab") {
        if (raw.project === undefined)
            errors.push(`${at}.project: required, a project id or a path such as acme/orders-api`);
        else if (typeof raw.project !== "string" || !GITLAB_PROJECT.test(raw.project)) {
            errors.push(`${at}.project: must be a project id or a path such as acme/orders-api`);
        }
        const required = checkRequired(raw.required, `${at}.required`, "job", errors);
        if (errors.length > before || url === undefined || auth === undefined) return undefined;
        return { system: kind, ...more, url, project: raw.project as string, auth, required };
    }
    if (kind === "concourse") return checkConcourse(raw, at, more, url, auth, before, errors);
    if (raw.job === undefined) errors.push(`${at}.job: required, the job with its folders, such as orders/build`);
    else if (typeof raw.job !== "string" || !JENKINS_JOB.test(raw.job)) {
        errors.push(`${at}.job: must be a job name with its folders, such as orders/build`);
    }
    const required = checkRequired(raw.required, `${at}.required`, "stage", errors);
    if (errors.length > before || url === undefined || auth === undefined) return undefined;
    return { system: kind, ...more, url, job: raw.job as string, auth, required };
}

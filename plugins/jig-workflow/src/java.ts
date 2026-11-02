// Choosing the JDK a Gradle build runs on, so a test run needs no per-repository `JAVA_HOME`. A wrapper pins its Gradle version, and
// a Gradle release runs only on some Java versions, so the machine's default Java may be too new (or too old) for one repository
// and right for the next. Everything is read from files and nothing is run: the wrapper's properties, the build files, and each
// JDK's `release` file.
//
// Gradle's own table says which Java versions a Gradle release runs on: the "Java" table, column "Support for running Gradle", at
// https://docs.gradle.org/current/userguide/compatibility.html (read on 2026-11-02, the page for Gradle 9.8.2). `FIRST_GRADLE_ON_JAVA`
// is that column; Gradle 9 and later need Java 17 or newer, and every release before 9 runs on Java 8.
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/** The first Gradle release that runs on each Java version. A Java version newer than the last row is not known to work. */
export const FIRST_GRADLE_ON_JAVA: ReadonlyArray<readonly [java: number, gradle: string]> = [
    [8, "2.0"],
    [9, "4.3"],
    [10, "4.7"],
    [11, "5.0"],
    [12, "5.4"],
    [13, "6.0"],
    [14, "6.3"],
    [15, "6.7"],
    [16, "7.0"],
    [17, "7.3"],
    [18, "7.5"],
    [19, "7.6"],
    [20, "8.3"],
    [21, "8.5"],
    [22, "8.8"],
    [23, "8.10"],
    [24, "8.14"],
    [25, "9.1.0"],
    [26, "9.4.0"],
    [27, "9.8.0"],
];

/** The oldest Gradle release that has a row in the table; an older wrapper is left alone. */
const OLDEST_GRADLE = "2.0";
/** Gradle 9 dropped Java 8 to 16: it needs 17 or newer to run. */
const GRADLE_9_MIN_JAVA = 17;

/** Where Java can be found, and who is asking. Folders are parameters so that a test never reads the machine's own JDKs. */
export interface JavaSources {
    home: string;
    /** Pi's environment: `JAVA_HOME`, `PATH` and `SDKMAN_DIR` are read, as places to look. */
    env: Readonly<Record<string, string | undefined>>;
    platform: NodeJS.Platform;
    /** Where Linux packages put JDKs. Default `/usr/lib/jvm`. */
    linuxJvmDir?: string;
    /** Where macOS puts them. Default `/Library/Java/JavaVirtualMachines`. */
    macJvmDir?: string;
}

/** An installed JDK, read from its `release` file. */
export interface Jdk {
    /** The folder, with links followed: what `JAVA_HOME` is set to. */
    home: string;
    major: number;
    /** `JAVA_VERSION` as the file says it: `17.0.9`, `1.8.0_392`. */
    version: string;
    /** The parts of the version after the major, to tell which patch release is newer. */
    patch: readonly number[];
    earlyAccess: boolean;
}

/** What to do about Java for one test command. */
export interface JavaChoice {
    /** What `JAVA_HOME` is set to. Absent when the machine's Java is left as it is, or when nothing fits. */
    home?: string;
    /** One line, for the result and the record: what was chosen and why, or what was found. */
    note: string;
    /** Set when no installed JDK fits: the run does not start, and this says what is needed and what was found. */
    problem?: string;
}

// ---- the build -------------------------------------------------------------------------------------------------------------

const MAX_BUILD_FILE_BYTES = 256 * 1024;
const MAX_BUILD_FILES = 100;

function readSmall(file: string): string | undefined {
    try {
        const text = readFileSync(file, "utf8");
        return text.length > MAX_BUILD_FILE_BYTES ? text.slice(0, MAX_BUILD_FILE_BYTES) : text;
    } catch {
        return undefined;
    }
}

/** A version as numbers, `7.6.4` to `[7, 6, 4]`. */
function numbers(version: string): number[] {
    return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

/** Negative when `a` is older than `b`, zero when they are the same, positive when newer. Missing parts are zero. */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

/** The Gradle version the wrapper downloads, from `distributionUrl` in `gradle/wrapper/gradle-wrapper.properties`. */
export function wrapperVersion(root: string): string | undefined {
    const text = readSmall(path.join(root, "gradle", "wrapper", "gradle-wrapper.properties"));
    const url = text === undefined ? undefined : /^\s*distributionUrl\s*[=:]\s*(.+)$/m.exec(text)?.[1];
    if (url === undefined) return undefined;
    // `gradle-7.6.4-bin.zip`, `gradle-8.5-rc-1-all.zip`, a mirror's address: the number after `gradle-` is the release.
    return /gradle-(\d+(?:\.\d+){0,2})(?:-[A-Za-z0-9.+_-]*?)?-(?:bin|all)\.zip/i.exec(url)?.[1];
}

/** Whether the build names the JDK that runs Gradle itself, which `JAVA_HOME` then cannot change. */
function namesItsOwnJava(root: string): boolean {
    const text = readSmall(path.join(root, "gradle.properties"));
    return text !== undefined && /^\s*org\.gradle\.java\.home\s*[=:]/m.test(text);
}

function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** `1.8` is Java 8, `11` is Java 11. Anything that is not a plausible Java version is left out. */
function levelOf(first: string, second?: string): number | undefined {
    const value = first === "1" && second !== undefined ? Number(second) : Number(first);
    return Number.isInteger(value) && value >= 5 && value <= 40 ? value : undefined;
}

const COMPATIBILITY =
    /\b(?:source|target)Compatibility\b\s*[=(]?\s*(?:JavaVersion\.toVersion\(\s*)?(?:JavaVersion\.VERSION_(\d+)(?:_(\d+))?|['"]?(\d+)(?:\.(\d+))?['"]?)/g;
const TOOLCHAIN = /\bJavaLanguageVersion\.of\(\s*(\d+)\s*\)|\bjvmToolchain\(\s*(\d+)\s*\)/g;

/** The Java levels a build file states: `sourceCompatibility`, `targetCompatibility`, `JavaVersion.VERSION_x`, a toolchain. */
export function levelsIn(source: string): number[] {
    const text = withoutComments(source);
    const found: number[] = [];
    for (const match of text.matchAll(COMPATIBILITY)) {
        const level =
            match[1] !== undefined ? levelOf(match[1], match[2]) : levelOf(match[3] as string, match[4] as string);
        if (level !== undefined) found.push(level);
    }
    for (const match of text.matchAll(TOOLCHAIN)) {
        const level = levelOf((match[1] ?? match[2]) as string);
        if (level !== undefined) found.push(level);
    }
    return found;
}

/** The highest Java level the build states, in the root's build file and in the build file of each folder just below it. */
export function buildLevel(root: string): number | undefined {
    const files: string[] = [];
    for (const name of ["build.gradle", "build.gradle.kts"]) files.push(path.join(root, name));
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
            for (const name of ["build.gradle", "build.gradle.kts"]) files.push(path.join(root, entry.name, name));
            if (files.length >= MAX_BUILD_FILES) break;
        }
    } catch {
        // A folder that cannot be listed has no build files to read.
    }
    let level: number | undefined;
    for (const file of files) {
        const text = readSmall(file);
        if (text === undefined) continue;
        for (const found of levelsIn(text)) level = Math.max(level ?? 0, found);
    }
    return level;
}

// ---- Gradle's table ----------------------------------------------------------------------------------------------------

/** The Java versions a Gradle release runs on, or undefined for a release older than the table. */
export function javaRangeOf(gradle: string): { min: number; max: number } | undefined {
    const version = numbers(gradle);
    if (compareVersions(version, numbers(OLDEST_GRADLE)) < 0) return undefined;
    let max = 8;
    for (const [java, first] of FIRST_GRADLE_ON_JAVA) if (compareVersions(version, numbers(first)) >= 0) max = java;
    return { min: version[0] !== undefined && version[0] >= 9 ? GRADLE_9_MIN_JAVA : 8, max };
}

// ---- the JDKs ----------------------------------------------------------------------------------------------------------

function listFolders(dir: string): string[] {
    try {
        return readdirSync(dir).map((name) => path.join(dir, name));
    } catch {
        return [];
    }
}

/** Reads one folder as a JDK: a `release` file that says `JAVA_VERSION`, and a compiler. Nothing is run. */
export function readJdk(folder: string): Jdk | undefined {
    let home: string;
    try {
        home = realpathSync(folder);
    } catch {
        return undefined;
    }
    const release = readSmall(path.join(home, "release"));
    const version = release === undefined ? undefined : /^JAVA_VERSION\s*=\s*"?([^"\r\n]+?)"?\s*$/m.exec(release)?.[1];
    if (version === undefined) return undefined;
    // A runtime with no compiler cannot build.
    if (!existsSync(path.join(home, "bin", "javac"))) return undefined;
    const legacy = /^1\.(\d+)/.exec(version);
    const major = Number(legacy?.[1] ?? /^(\d+)/.exec(version)?.[1]);
    if (!Number.isInteger(major) || major < 1) return undefined;
    // `1.8.0_392` is release 0, update 392 of Java 8; `17.0.9` is 0 and 9 of Java 17.
    const rest = (legacy === null ? version : version.replace(/^1\./, "")).replace(/^\d+/, "");
    const patch = (/^[._]?([\d._]*)/.exec(rest)?.[1] ?? "")
        .split(/[._]/)
        .filter((part) => part !== "")
        .map(Number);
    return { home, major, version, patch, earlyAccess: /-(?:ea|beta|internal)/i.test(version) };
}

/** The folders where JDKs usually are, in the order they are looked at. */
function candidateFolders(sources: JavaSources): string[] {
    const { home, env, platform } = sources;
    const folders: string[] = [];
    if (env.JAVA_HOME) folders.push(env.JAVA_HOME);
    for (const entry of (env.PATH ?? "").split(path.delimiter)) {
        if (entry === "" || !path.isAbsolute(entry)) continue;
        const java = path.join(entry, "java");
        try {
            // `.../bin/java` is in the JDK's `bin`: two folders up is the JDK.
            if (existsSync(java)) folders.push(path.dirname(path.dirname(realpathSync(java))));
        } catch {
            // A broken link is no Java.
        }
    }
    folders.push(...listFolders(path.join(env.SDKMAN_DIR ?? path.join(home, ".sdkman"), "candidates", "java")));
    folders.push(...listFolders(sources.linuxJvmDir ?? "/usr/lib/jvm"));
    if (platform === "darwin") {
        for (const dir of [
            sources.macJvmDir ?? "/Library/Java/JavaVirtualMachines",
            path.join(home, "Library", "Java", "JavaVirtualMachines"),
        ]) {
            folders.push(...listFolders(dir).map((folder) => path.join(folder, "Contents", "Home")));
        }
    }
    return folders;
}

/** Every installed JDK that can be read, once each, newest release first within a Java version. */
export function installedJdks(sources: JavaSources): Jdk[] {
    const byHome = new Map<string, Jdk>();
    for (const folder of candidateFolders(sources)) {
        const jdk = readJdk(folder);
        if (jdk !== undefined && !byHome.has(jdk.home)) byHome.set(jdk.home, jdk);
    }
    return [...byHome.values()].sort((a, b) => a.major - b.major || newest(a, b));
}

/** Negative when `a` is the better release of one Java version: not an early access one, and the newer patch. */
function newest(a: Jdk, b: Jdk): number {
    if (a.earlyAccess !== b.earlyAccess) return a.earlyAccess ? 1 : -1;
    return compareVersions(b.patch, a.patch);
}

/** The JDK that runs when nothing is set: `JAVA_HOME`'s, else the `java` first on `PATH`. */
function defaultJdk(sources: JavaSources): Jdk | undefined {
    const { env } = sources;
    if (env.JAVA_HOME) {
        const jdk = readJdk(env.JAVA_HOME);
        if (jdk !== undefined) return jdk;
    }
    for (const entry of (env.PATH ?? "").split(path.delimiter)) {
        if (entry === "" || !path.isAbsolute(entry)) continue;
        try {
            const java = path.join(entry, "java");
            if (existsSync(java)) return readJdk(path.dirname(path.dirname(realpathSync(java))));
        } catch {
            // Not this one.
        }
    }
    return undefined;
}

// ---- the choice --------------------------------------------------------------------------------------------------------

/** A command that runs a Gradle wrapper: `./gradlew test`, `cd app && ./gradlew test`, `sh gradlew build`. */
export function runsGradleWrapper(command: string): boolean {
    return /(?:^|[\s;&|(])(?:\S*\/)?gradlew(?:\.bat)?(?=$|[\s;&|)])/.test(command);
}

/** A command that sets `JAVA_HOME` itself, which is configuration of a kind and wins. */
function setsJavaHome(command: string): boolean {
    return /(?:^|[\s;&|(])(?:export\s+)?JAVA_HOME=/.test(command);
}

function shownPath(folder: string, home: string): string {
    return folder === home ? "~" : folder.startsWith(`${home}${path.sep}`) ? `~${folder.slice(home.length)}` : folder;
}

function range(min: number, max: number): string {
    return min === max ? `Java ${min}` : `Java ${min} to ${max}`;
}

/**
 * The JDK for a test command, or undefined when this is not a case for it: the command does not run a Gradle wrapper, it sets
 * `JAVA_HOME` itself, the build names its own Java (`org.gradle.java.home`), or the wrapper's Gradle version is not known.
 * The caller does not ask when the configuration sets `env.JAVA_HOME`: that wins.
 *
 * With a Java level stated by the build, the lowest installed Java that is at least that level and that Gradle runs on is chosen,
 * and of that Java version the newest patch release. With none stated, a default Java that Gradle runs on stays, and otherwise the
 * newest installed one that it runs on is chosen: a level nobody stated is more likely too low than too high.
 */
export function chooseJava(root: string, command: string, sources: JavaSources): JavaChoice | undefined {
    if (!runsGradleWrapper(command) || setsJavaHome(command) || namesItsOwnJava(root)) return undefined;
    const gradle = wrapperVersion(root);
    const allowed = gradle === undefined ? undefined : javaRangeOf(gradle);
    if (gradle === undefined || allowed === undefined) return undefined;
    const level = buildLevel(root);
    const runs = `Gradle ${gradle} runs on ${range(allowed.min, allowed.max)}`;
    const wants = level === undefined ? "the build states no Java level" : `the build asks for Java ${level} or newer`;
    const found = installedJdks(sources);
    const fitting = found.filter((jdk) => jdk.major >= Math.max(allowed.min, level ?? 0) && jdk.major <= allowed.max);
    const show = (jdk: Jdk): string => `${jdk.version} (${shownPath(jdk.home, sources.home)})`;

    if (found.length === 0) {
        return { note: `no installed JDK was found, so the machine's own Java is used; ${runs} and ${wants}.` };
    }
    if (fitting.length === 0) {
        const have = found.map(show).join(", ");
        const need =
            level !== undefined && level > allowed.max
                ? `no Java satisfies both: use a newer Gradle wrapper, or a build that asks for less`
                : `install a JDK of ${range(Math.max(allowed.min, level ?? 0), allowed.max)}, or set env.JAVA_HOME for this repository in workflow.tests`;
        return {
            note: `no installed JDK fits: ${runs} and ${wants}; found ${have}.`,
            problem: `no installed JDK fits: ${runs} and ${wants}; found ${have}. ${need[0]?.toUpperCase()}${need.slice(1)}.`,
        };
    }
    if (level === undefined) {
        const standing = defaultJdk(sources);
        if (standing !== undefined && standing.major >= allowed.min && standing.major <= allowed.max) {
            return { note: `the default Java ${show(standing)} stays: ${runs} and ${wants}.` };
        }
        // The highest Java version that fits, and its newest release.
        const top = Math.max(...fitting.map((jdk) => jdk.major));
        const pick = fitting.find((jdk) => jdk.major === top) as Jdk;
        const why =
            standing === undefined
                ? "no default Java was found"
                : `the default Java ${standing.version} is not one it runs on`;
        return {
            home: pick.home,
            note: `Java ${show(pick)}, the newest installed that Gradle ${gradle} runs on, because ${why} and ${wants}.`,
        };
    }
    const lowest = Math.min(...fitting.map((jdk) => jdk.major));
    const pick = fitting.find((jdk) => jdk.major === lowest) as Jdk;
    return {
        home: pick.home,
        note: `Java ${show(pick)}, the lowest installed that fits: ${runs}, and ${wants}.`,
    };
}

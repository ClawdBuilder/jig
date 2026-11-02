// Choosing a JDK for a Gradle build: the wrapper's version, the build's Java level, Gradle's table, the JDKs on the machine (fake
// folders with `release` files, never the machine's own), and the choice. No Java runs.
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import {
    FIRST_GRADLE_ON_JAVA,
    buildLevel,
    chooseJava,
    compareVersions,
    installedJdks,
    javaRangeOf,
    levelsIn,
    readJdk,
    runsGradleWrapper,
    wrapperVersion,
} from "../src/java.ts";
import type { JavaSources } from "../src/java.ts";
import { tempFolder } from "./support.ts";

const wrapper = (version: string, url = `https\\://services.gradle.org/distributions/gradle-${version}-bin.zip`) =>
    `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=${url}\nzipStoreBase=GRADLE_USER_HOME\n`;

/** A build folder: the wrapper's Gradle version, and the files named, relative to it. */
function build(t: Parameters<typeof tempFolder>[0], gradle: string | undefined, files: Record<string, string> = {}) {
    const root = tempFolder(t, "jig-build-");
    const all = {
        ...(gradle === undefined ? {} : { "gradle/wrapper/gradle-wrapper.properties": wrapper(gradle) }),
        ...files,
    };
    for (const [name, content] of Object.entries(all)) {
        mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        writeFileSync(path.join(root, name), content);
    }
    return root;
}

/** A fake JDK folder: a `release` file, and the programs a JDK has (empty files: nothing is run). */
function jdk(folder: string, version: string, over: { javac?: boolean; quote?: boolean } = {}): string {
    mkdirSync(path.join(folder, "bin"), { recursive: true });
    writeFileSync(path.join(folder, "bin", "java"), "");
    if (over.javac !== false) writeFileSync(path.join(folder, "bin", "javac"), "");
    writeFileSync(
        path.join(folder, "release"),
        `IMPLEMENTOR="Example"\nJAVA_VERSION=${over.quote === false ? version : `"${version}"`}\nOS_NAME="Linux"\n`,
    );
    return folder;
}

/** Fake places for JDKs: the home folder (with sdkman), a Linux system folder and a macOS one, all in a temporary folder. */
function machine(
    t: Parameters<typeof tempFolder>[0],
    env: JavaSources["env"] = {},
    platform: NodeJS.Platform = "linux",
) {
    const root = tempFolder(t, "jig-machine-");
    const home = path.join(root, "home");
    const sources: JavaSources = {
        home,
        env,
        platform,
        linuxJvmDir: path.join(root, "jvm"),
        macJvmDir: path.join(root, "mac"),
    };
    return {
        root,
        home,
        sources,
        sdkman: (name: string, version: string) => jdk(path.join(home, ".sdkman", "candidates", "java", name), version),
        system: (name: string, version: string) => jdk(path.join(root, "jvm", name), version),
    };
}

describe("the Gradle version of a wrapper", () => {
    test("is the number in the distribution address, however the address is written", (t) => {
        for (const [url, expected] of [
            [undefined, "7.6.4"],
            ["https\\://services.gradle.org/distributions/gradle-8.5-all.zip", "8.5"],
            ["https://services.gradle.org/distributions/gradle-9.0.0-bin.zip", "9.0.0"],
            ["https\\://services.gradle.org/distributions/gradle-8.5-rc-1-bin.zip", "8.5"],
            ["https\\://mirror.example.com/gradle/gradle-2.14.1-bin.zip", "2.14.1"],
            ["file\\:///opt/dists/gradle-6.9-bin.zip", "6.9"],
        ] as const) {
            const root = build(t, undefined, {
                "gradle/wrapper/gradle-wrapper.properties": wrapper("7.6.4", url ?? undefined),
            });
            assert.equal(wrapperVersion(root), expected, String(url));
        }
    });

    test("is not known without a wrapper, or from an address that names no release", (t) => {
        assert.equal(wrapperVersion(build(t, undefined)), undefined);
        const odd = build(t, undefined, {
            "gradle/wrapper/gradle-wrapper.properties": wrapper("1", "https\\://example.com/dist/latest.zip"),
        });
        assert.equal(wrapperVersion(odd), undefined);
    });
});

describe("the Java level a build states", () => {
    test("each way of writing it", () => {
        const cases: Array<[string, number[]]> = [
            ["sourceCompatibility = '1.8'", [8]],
            ['targetCompatibility = "11"', [11]],
            ["sourceCompatibility = 17", [17]],
            ["sourceCompatibility 11", [11]],
            ["sourceCompatibility = JavaVersion.VERSION_1_8", [8]],
            ["java.targetCompatibility = JavaVersion.VERSION_17", [17]],
            ["sourceCompatibility = JavaVersion.toVersion('11')", [11]],
            ["java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }", [21]],
            ["java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }", [17]],
            ["kotlin { jvmToolchain(17) }", [17]],
            ["sourceCompatibility = 1.8\ntargetCompatibility = 11", [8, 11]],
        ];
        for (const [text, expected] of cases) assert.deepEqual(levelsIn(text), expected, text);
    });

    test("not from a comment, a check of the running Java, or something that is not a version", () => {
        for (const text of [
            "// sourceCompatibility = 17",
            "/* targetCompatibility = JavaVersion.VERSION_17 */",
            "if (JavaVersion.current() < JavaVersion.VERSION_17) { println 'old' }",
            "sourceCompatibility = rootProject.ext.javaVersion",
            "sourceCompatibility = JavaVersion.VERSION_HIGHER",
            "sourceCompatibility = 99",
        ]) {
            assert.deepEqual(levelsIn(text), [], text);
        }
        assert.deepEqual(levelsIn('url = "https://repo.example.com"\nsourceCompatibility = 11 // the minimum'), [11]);
    });

    test("is the highest one of the root's build file and of the build files just below it", (t) => {
        const root = build(t, "7.6.4", {
            "build.gradle": "sourceCompatibility = '1.8'",
            "api/build.gradle": "sourceCompatibility = 11",
            "core/build.gradle.kts": "java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }",
            "core/deep/build.gradle": "sourceCompatibility = 21",
        });
        assert.equal(buildLevel(root), 17, "a build file two folders down is not read");
        assert.equal(buildLevel(build(t, "7.6.4", { "build.gradle": "plugins { id 'java' }" })), undefined);
        assert.equal(buildLevel(build(t, "7.6.4")), undefined);
    });
});

describe("Gradle's table", () => {
    test("each release runs on the Java versions the table gives", () => {
        const expected: Array<[string, number, number]> = [
            ["2.14.1", 8, 8],
            ["4.10.3", 8, 10],
            ["5.6.4", 8, 12],
            ["6.9.4", 8, 15],
            ["7.0", 8, 16],
            ["7.3.3", 8, 17],
            ["7.6.4", 8, 19],
            ["8.4", 8, 20],
            ["8.5", 8, 21],
            ["8.14.3", 8, 24],
            ["9.0.0", 17, 24],
            ["9.1.0", 17, 25],
            ["9.8.2", 17, 27],
        ];
        for (const [gradle, min, max] of expected) assert.deepEqual(javaRangeOf(gradle), { min, max }, gradle);
    });

    test("a release older than the table is left alone", () => {
        assert.equal(javaRangeOf("1.12"), undefined);
    });

    test("the rows are in order, and a version compares by its numbers, not its text", () => {
        const rows = FIRST_GRADLE_ON_JAVA;
        for (const [index, [java, gradle]] of rows.entries()) {
            const [before, earlier] = rows[index - 1] ?? [java - 1, "0"];
            assert.equal(java, before + 1);
            assert.ok(compareVersions(gradle.split(".").map(Number), earlier.split(".").map(Number)) >= 0);
        }
        assert.ok(compareVersions([8, 14], [8, 5]) > 0);
        assert.equal(compareVersions([9], [9, 0, 0]), 0);
    });
});

describe("reading a JDK", () => {
    test("from its release file: the new version scheme, the old one, a bare number, an early access build", (t) => {
        const dir = tempFolder(t);
        const read = (version: string, quote = true) =>
            readJdk(jdk(path.join(dir, `jdk-${version}-${quote}`), version, { quote }));
        assert.deepEqual(
            [read("17.0.9")?.major, read("17.0.9")?.patch, read("17.0.9")?.version],
            [17, [0, 9], "17.0.9"],
        );
        assert.deepEqual([read("1.8.0_392")?.major, read("1.8.0_392")?.patch], [8, [0, 392]]);
        assert.deepEqual([read("21")?.major, read("21")?.patch], [21, []]);
        assert.deepEqual([read("11.0.31", false)?.major, read("11.0.31", false)?.earlyAccess], [11, false]);
        assert.deepEqual([read("26-ea")?.major, read("26-ea")?.earlyAccess], [26, true]);
    });

    test("not from a runtime with no compiler, a folder with no release file, or one that says no version", (t) => {
        const dir = tempFolder(t);
        assert.equal(readJdk(jdk(path.join(dir, "jre"), "17.0.9", { javac: false })), undefined);
        mkdirSync(path.join(dir, "empty"));
        assert.equal(readJdk(path.join(dir, "empty")), undefined);
        assert.equal(readJdk(path.join(dir, "missing")), undefined);
        mkdirSync(path.join(dir, "odd", "bin"), { recursive: true });
        writeFileSync(path.join(dir, "odd", "bin", "javac"), "");
        writeFileSync(path.join(dir, "odd", "release"), 'IMPLEMENTOR="Example"\n');
        assert.equal(readJdk(path.join(dir, "odd")), undefined);
    });
});

describe("finding the JDKs of a machine", () => {
    test("in JAVA_HOME, on PATH, in sdkman's folder, in the system folder, each once, in order of Java version and release", (t) => {
        const m = machine(t);
        const a = m.sdkman("17.0.19-tem", "17.0.19");
        m.sdkman("17.0.9-tem", "17.0.9");
        m.sdkman("21.0.11-tem", "21.0.11");
        m.sdkman("8.0.492-tem", "1.8.0_492");
        m.system("java-11-openjdk-amd64", "11.0.25");
        // `current` is a link to one of them: the same JDK, seen once.
        symlinkSync(a, path.join(m.home, ".sdkman", "candidates", "java", "current"));
        const onPath = jdk(path.join(m.root, "opt", "jdk-25"), "25");
        mkdirSync(path.join(m.root, "bin"));
        symlinkSync(path.join(onPath, "bin", "java"), path.join(m.root, "bin", "java"));
        const sources = {
            ...m.sources,
            env: { JAVA_HOME: a, PATH: `/nonexistent:relative:${path.join(m.root, "bin")}` },
        };
        assert.deepEqual(
            installedJdks(sources).map((found) => found.version),
            ["1.8.0_492", "11.0.25", "17.0.19", "17.0.9", "21.0.11", "25"],
        );
    });

    test("sdkman where SDKMAN_DIR says, and macOS's folders on a Mac", (t) => {
        const m = machine(t, {}, "darwin");
        jdk(path.join(m.root, "elsewhere", "candidates", "java", "17.0.9-tem"), "17.0.9");
        jdk(path.join(m.root, "mac", "temurin-21.jdk", "Contents", "Home"), "21.0.5");
        jdk(path.join(m.home, "Library", "Java", "JavaVirtualMachines", "corretto-11", "Contents", "Home"), "11.0.20");
        jdk(path.join(m.root, "jvm", "java-8"), "1.8.0_392");
        const sources = { ...m.sources, env: { SDKMAN_DIR: path.join(m.root, "elsewhere") } };
        assert.deepEqual(
            installedJdks(sources).map((found) => found.version),
            ["1.8.0_392", "11.0.20", "17.0.9", "21.0.5"],
        );
        assert.deepEqual(
            installedJdks({ ...sources, platform: "linux" }).map((found) => found.version),
            ["1.8.0_392", "17.0.9"],
            "macOS's folders are read on a Mac only",
        );
    });

    test("a patch release that is not an early access one comes first", (t) => {
        const m = machine(t);
        m.sdkman("26-ea", "26-ea");
        m.sdkman("26", "26");
        m.sdkman("17.0.10-ea", "17.0.10-ea");
        m.sdkman("17.0.9", "17.0.9");
        assert.deepEqual(
            installedJdks(m.sources).map((found) => found.version),
            ["17.0.9", "17.0.10-ea", "26", "26-ea"],
        );
    });
});

describe("which command runs a Gradle wrapper", () => {
    test("the wrapper, wherever it is in the command; not Gradle itself", () => {
        for (const command of [
            "./gradlew test",
            "gradlew test",
            "cd app && ./gradlew test --info",
            "sh ./gradlew build",
            "FOO=1 ./gradlew test",
            "(./gradlew test)",
            "../tools/gradlew test",
            "./gradlew",
        ]) {
            assert.equal(runsGradleWrapper(command), true, command);
        }
        for (const command of ["gradle test", "npm test", "./gradlew-docs test", "echo mygradlew", "mvn -q test"]) {
            assert.equal(runsGradleWrapper(command), false, command);
        }
    });
});

describe("the choice", () => {
    test("the lowest installed Java that is at least the build's level and that Gradle runs on, newest patch of it", (t) => {
        const m = machine(t);
        m.sdkman("8.0.492-tem", "1.8.0_492");
        m.sdkman("11.0.20-tem", "11.0.20");
        const newest = m.sdkman("11.0.31-tem", "11.0.31");
        m.sdkman("17.0.19-tem", "17.0.19");
        m.sdkman("21.0.11-tem", "21.0.11");
        const root = build(t, "6.9.4", { "build.gradle": "sourceCompatibility = 11" });
        const choice = chooseJava(root, "./gradlew test", m.sources);
        assert.equal(choice?.home, newest);
        assert.equal(choice?.problem, undefined);
        assert.equal(
            choice?.note,
            "Java 11.0.31 (~/.sdkman/candidates/java/11.0.31-tem), the lowest installed that fits: Gradle 6.9.4 runs on Java 8 to 15, and the build asks for Java 11 or newer.",
        );
        // The same machine for a build that says 8, and one that says 17 on a newer Gradle.
        assert.match(
            chooseJava(
                build(t, "6.9.4", { "build.gradle": "sourceCompatibility = '1.8'" }),
                "./gradlew test",
                m.sources,
            )?.home ?? "",
            /8\.0\.492-tem$/,
        );
        assert.match(
            chooseJava(
                build(t, "8.5", { "build.gradle.kts": "kotlin { jvmToolchain(17) }" }),
                "./gradlew test",
                m.sources,
            )?.home ?? "",
            /17\.0\.19-tem$/,
        );
    });

    test("a Java that Gradle does not run on is never chosen, even when it is the only one at that level", (t) => {
        const m = machine(t);
        m.sdkman("17.0.19-tem", "17.0.19");
        m.sdkman("25-tem", "25");
        // Gradle 7.6 runs on 8 to 19, the build asks for 11: 17 is the one; 25 is too new.
        const choice = chooseJava(
            build(t, "7.6.4", { "build.gradle": "sourceCompatibility = 11" }),
            "./gradlew test",
            m.sources,
        );
        assert.match(choice?.home ?? "", /17\.0\.19-tem$/);
    });

    test("Gradle 9 needs Java 17 or newer, whatever the build says", (t) => {
        const m = machine(t);
        m.sdkman("11.0.31-tem", "11.0.31");
        m.sdkman("17.0.19-tem", "17.0.19");
        m.sdkman("21.0.11-tem", "21.0.11");
        const choice = chooseJava(
            build(t, "9.0.0", { "build.gradle": "sourceCompatibility = 11" }),
            "./gradlew test",
            m.sources,
        );
        assert.match(choice?.home ?? "", /17\.0\.19-tem$/);
        assert.match(choice?.note ?? "", /Gradle 9\.0\.0 runs on Java 17 to 24/);
    });

    test("with no level stated, a default Java that Gradle runs on stays", (t) => {
        const m = machine(t);
        const twentyOne = m.sdkman("21.0.11-tem", "21.0.11");
        m.sdkman("17.0.19-tem", "17.0.19");
        const sources = { ...m.sources, env: { JAVA_HOME: twentyOne } };
        const choice = chooseJava(build(t, "8.5"), "./gradlew test", sources);
        assert.equal(choice?.home, undefined);
        assert.equal(choice?.problem, undefined);
        assert.equal(
            choice?.note,
            "the default Java 21.0.11 (~/.sdkman/candidates/java/21.0.11-tem) stays: Gradle 8.5 runs on Java 8 to 21 and the build states no Java level.",
        );
    });

    test("with no level stated and a default that is too new, the newest Java that Gradle runs on", (t) => {
        const m = machine(t);
        const twentyOne = m.sdkman("21.0.11-tem", "21.0.11");
        m.sdkman("8.0.492-tem", "1.8.0_492");
        m.sdkman("11.0.31-tem", "11.0.31");
        m.sdkman("17.0.19-tem", "17.0.19");
        const sources = { ...m.sources, env: { JAVA_HOME: twentyOne } };
        const choice = chooseJava(build(t, "6.9.4"), "./gradlew test", sources);
        assert.match(choice?.home ?? "", /11\.0\.31-tem$/);
        assert.match(
            choice?.note ?? "",
            /the newest installed that Gradle 6\.9\.4 runs on, because the default Java 21\.0\.11 is not one it runs on/,
        );
        // No default at all: the same pick, said another way.
        assert.match(
            chooseJava(build(t, "6.9.4"), "./gradlew test", m.sources)?.note ?? "",
            /because no default Java was found/,
        );
    });

    test("when nothing fits, the result says what is needed and what was found, and nothing is chosen", (t) => {
        const m = machine(t);
        m.sdkman("21.0.11-tem", "21.0.11");
        m.system("java-25-openjdk-amd64", "25");
        const choice = chooseJava(
            build(t, "6.9.4", { "build.gradle": "sourceCompatibility = 11" }),
            "./gradlew test",
            m.sources,
        );
        assert.equal(choice?.home, undefined);
        assert.equal(
            choice?.problem,
            `no installed JDK fits: Gradle 6.9.4 runs on Java 8 to 15 and the build asks for Java 11 or newer; found 21.0.11 (~/.sdkman/candidates/java/21.0.11-tem), 25 (${m.root}/jvm/java-25-openjdk-amd64). Install a JDK of Java 11 to 15, or set env.JAVA_HOME for this repository in workflow.tests.`,
        );
        assert.match(choice?.note ?? "", /^no installed JDK fits: /);
    });

    test("a build that asks for more than its Gradle runs on has no answer, and says so", (t) => {
        const m = machine(t);
        m.sdkman("21.0.11-tem", "21.0.11");
        const choice = chooseJava(
            build(t, "6.9.4", { "build.gradle": "sourceCompatibility = 21" }),
            "./gradlew test",
            m.sources,
        );
        assert.match(
            choice?.problem ?? "",
            /the build asks for Java 21 or newer; found 21\.0\.11 .* No Java satisfies both: use a newer Gradle wrapper/,
        );
    });

    test("a runtime with no compiler is not a JDK", (t) => {
        const m = machine(t);
        jdk(path.join(m.home, ".sdkman", "candidates", "java", "11-jre"), "11.0.31", { javac: false });
        m.sdkman("8.0.492-tem", "1.8.0_492");
        const choice = chooseJava(build(t, "6.9.4"), "./gradlew test", { ...m.sources, env: {} });
        assert.match(choice?.home ?? "", /8\.0\.492-tem$/);
    });

    test("no JDK found at all leaves the machine's own Java, and says so", (t) => {
        const m = machine(t);
        const choice = chooseJava(build(t, "6.9.4"), "./gradlew test", m.sources);
        assert.equal(choice?.home, undefined);
        assert.equal(choice?.problem, undefined);
        assert.match(
            choice?.note ?? "",
            /^no installed JDK was found, so the machine's own Java is used; Gradle 6\.9\.4 runs on Java 8 to 15/,
        );
    });

    test("it is not a case for it: another command, a JAVA_HOME of the command's own, a Java the build names, no wrapper", (t) => {
        const m = machine(t);
        m.sdkman("11.0.31-tem", "11.0.31");
        const root = build(t, "6.9.4");
        assert.notEqual(chooseJava(root, "./gradlew test", m.sources), undefined, "control");
        for (const command of [
            "npm test",
            "gradle test",
            "JAVA_HOME=/opt/jdk ./gradlew test",
            "export JAVA_HOME=/x && ./gradlew test",
        ]) {
            assert.equal(chooseJava(root, command, m.sources), undefined, command);
        }
        const names = build(t, "6.9.4", {
            "gradle.properties": "org.gradle.jvmargs=-Xmx2g\norg.gradle.java.home=/opt/some-jdk\n",
        });
        assert.equal(chooseJava(names, "./gradlew test", m.sources), undefined);
        assert.equal(chooseJava(build(t, undefined), "./gradlew test", m.sources), undefined, "no wrapper properties");
        assert.equal(chooseJava(build(t, "1.12"), "./gradlew test", m.sources), undefined, "older than the table");
    });

    test("the folder chosen is shown as the user knows it, with ~ for the home folder", (t) => {
        const m = machine(t);
        const folder = m.sdkman("17.0.19-tem", "17.0.19");
        const choice = chooseJava(
            build(t, "7.6.4", { "build.gradle": "sourceCompatibility = 17" }),
            "./gradlew test",
            m.sources,
        );
        assert.equal(choice?.home, folder);
        assert.ok(choice?.note.includes("~/.sdkman/candidates/java/17.0.19-tem"), choice?.note);
    });
});

// The JSON form of `/jig doctor`'s report: schema 1. A consumer may rely on the fields below; a later version may add
// fields, and only a new schema may change or remove one. It holds no secret value and no reference: a fix line may
// name a store and an entry, never what the store holds.
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DoctorLevel, DoctorLine, DoctorReport } from "./doctor.ts";
import { DOCTOR_GROUPS } from "./doctor.ts";
import { replaceFileDurably } from "./kit/files.ts";

export const DOCTOR_REPORT_SCHEMA = 1;

export interface DoctorReportCheck {
    id: string;
    level: DoctorLevel;
    title: string;
    detail?: string;
    fix?: string;
    data?: Record<string, string | number | boolean>;
}

export interface DoctorReportGroup {
    id: string;
    title: string;
    checks: DoctorReportCheck[];
}

export interface DoctorReportFile {
    schema: 1;
    generated: string;
    jig: string | null;
    pi: string | null;
    node: string;
    platform: string;
    network: boolean;
    summary: Record<DoctorLevel, number>;
    groups: DoctorReportGroup[];
}

/** Where `--json` writes its report: one file, replaced whole, so a reader always sees one report. */
export function doctorReportFile(stateDir: string): string {
    return path.join(stateDir, "doctor.json");
}

/** The report as one JSON value. `generated` is passed in, so a test can pin it. */
export function reportJson(report: DoctorReport, generated: Date): DoctorReportFile {
    return {
        schema: DOCTOR_REPORT_SCHEMA,
        generated: generated.toISOString(),
        jig: report.meta.jig,
        pi: report.meta.pi,
        node: report.meta.node,
        platform: report.meta.platform,
        network: report.meta.network,
        summary: { ...report.counts },
        groups: DOCTOR_GROUPS.flatMap((group) => {
            const checks = report.lines.filter((line) => line.group === group.id).map(checkJson);
            return checks.length === 0 ? [] : [{ id: group.id, title: group.title, checks }];
        }),
    };
}

/** Writes the report privately and atomically, creating the state folder when it is not there yet. */
export function writeDoctorReport(report: DoctorReport, file: string, generated: Date): void {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    replaceFileDurably(file, `${JSON.stringify(reportJson(report, generated), null, 2)}\n`, 0o600);
}

function checkJson(line: DoctorLine): DoctorReportCheck {
    return {
        id: line.id,
        level: line.level,
        title: line.title,
        ...(line.detail === undefined ? {} : { detail: line.detail }),
        ...(line.fix === undefined ? {} : { fix: line.fix }),
        ...(line.data === undefined ? {} : { data: { ...line.data } }),
    };
}

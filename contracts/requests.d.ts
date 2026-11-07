export const REQUEST_SCHEMA: 1;
export const MAX_REQUEST_BYTES: number;
export interface Request { schema: 1; id: string | null; tools: Record<string, boolean>; skills: Record<string, boolean>; reload: boolean; }
export function parseRequest(text: string): { request?: Request; error?: string };
export function takeRequest(file: string): string | null | undefined;
export function ensureRequestsDir(dir: string): void;
export function sweepRequests(dir: string, live: (name: string) => boolean, keep: string, now?: number): string[];

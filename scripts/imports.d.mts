/** One module specifier in a source file, and the line it is on (1-based). */
export interface Import {
    specifier: string;
    line: number;
    /** Written as `import type` or `export type`, or a type expression such as `import("a").T`: it loads nothing at run time. */
    typeOnly: boolean;
}

export interface ImportOptions {
    /** False leaves out the type expressions `import("a").T` and `typeof import("a")`. Default true. */
    typeExpressions?: boolean;
}

/** Every specifier a source text imports or re-exports: static and dynamic imports, `export ... from`, and `require`. */
export function importsOf(text: string, options?: ImportOptions): Import[];

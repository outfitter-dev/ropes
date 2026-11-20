import type { Finding } from "../../contracts/finding.ts";

/** An error with a place, as `bun check --no-pretty` prints it on stdout. */
const LOCATED =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.*)$/u;
/** An error with no place: a file it could not open, a flag it refused. */
const GLOBAL = /^error (?<code>TS\d+): (?<message>.*)$/u;

/**
 * On GitHub Actions each error is printed a second time, after the others,
 * as a workflow command that annotates the pull request.
 */
const ANNOTATION = /^::error (?:file=.*,)?title=TS\d+::/u;

const FOUND = /^Found (?<count>\d+) errors?\b/mu;
const CLEAN = /No type errors/u;
const STOPPED = /^note: Stopped before type checking/mu;

export interface Diagnostics {
  /** Errors with a place. The path is as the compiler printed it. */
  readonly located: readonly Finding[];
  /** The messages of errors with no place. */
  readonly global: readonly string[];
}

export type Parsed =
  | ({ readonly ok: true } & Diagnostics)
  | { readonly ok: false; readonly message: string };

/** What the last lines on stderr say about the run. */
export interface Summary {
  /** How many errors it says it found. Undefined when it does not say. */
  readonly found?: number;
  /** True when it says there were no type errors. */
  readonly clean: boolean;
  /** True when a file did not parse, and it checked no types at all. */
  readonly stopped: boolean;
}

export const summaryOf = (stderr: string): Summary => {
  const count = FOUND.exec(stderr)?.groups?.count;
  return {
    clean: CLEAN.test(stderr),
    ...(count === undefined ? {} : { found: Number(count) }),
    stopped: STOPPED.test(stderr),
  };
};

interface Entry {
  readonly lines: string[];
  readonly finding?: Omit<Finding, "message">;
}

const entryOf = (line: string, source: string): Entry | undefined => {
  const located = LOCATED.exec(line)?.groups;
  if (located !== undefined) {
    return {
      finding: {
        fixable: false,
        path: located.file ?? "",
        range: {
          start: {
            column: Number(located.column),
            line: Number(located.line),
          },
        },
        rule: located.code ?? "",
        severity: "error",
        source,
      },
      lines: [located.message ?? ""],
    };
  }
  const message = GLOBAL.exec(line)?.groups?.message;
  return message === undefined ? undefined : { lines: [message] };
};

/**
 * Reads the errors one run printed. An indented line continues the error
 * above it. An annotation repeats an error and is passed over, as long as
 * there is one for each error. Any other line it cannot place makes the
 * output unusable: an error would otherwise be dropped unseen.
 */
export const parseOutput = (stdout: string, source: string): Parsed => {
  const entries: Entry[] = [];
  let annotations = 0;
  for (const line of stdout.split("\n")) {
    const entry = entryOf(line, source);
    const last = entries.at(-1);
    if (entry !== undefined) {
      entries.push(entry);
    } else if (ANNOTATION.test(line)) {
      annotations += 1;
    } else if (/^\s+\S/u.test(line) && last !== undefined) {
      last.lines.push(line.trim());
    } else if (line.trim() !== "") {
      return {
        message: `it printed a line that is no error: ${line}`,
        ok: false,
      };
    }
  }
  if (annotations > 0 && annotations !== entries.length) {
    return {
      message: `it printed ${entries.length} errors and ${annotations} annotations for them`,
      ok: false,
    };
  }
  return {
    global: entries
      .filter((entry) => entry.finding === undefined)
      .map((entry) => entry.lines.join(" ")),
    located: entries.flatMap((entry) =>
      entry.finding === undefined
        ? []
        : [{ ...entry.finding, message: entry.lines.join(" ") }]
    ),
    ok: true,
  };
};

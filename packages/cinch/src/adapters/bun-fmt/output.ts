import type { Finding } from "../../contracts/finding.ts";

/**
 * A file the formatter could not parse, as Bun 1.4.4 prints it on stderr:
 * the message, then the place on the next line. A file it cannot parse and
 * so passes over, such as malformed TOML, is a `warn` and does not change
 * the exit code. One that stops it is an `error`, and the run exits 2.
 */
const PARSE_ERROR =
  /^(?<level>error|warn): (?<message>.+)\n\s+at (?<file>.+):(?<line>\d+):(?<column>\d+)$/gmu;

/** The start of a parse error that stops the formatter. */
const STOPPED = /^error: .+\n\s+at .+:\d+:\d+$/mu;

/** A file the formatter could not write, with the reason on the next line. */
const WRITE_ERROR =
  /^error: Unable to write file "(?<file>.+)":\n(?<reason>.+)$/gmu;

/** The rule a file that needs formatting is reported under. */
export const UNFORMATTED_RULE = "format";
/** The rule a file the formatter cannot parse is reported under. */
export const PARSE_RULE = "syntax";

export type Parsed =
  | {
      readonly ok: true;
      readonly files: ReadonlyMap<string, Finding[]>;
      /** True when a file stopped the formatter, which makes it exit 2. */
      readonly stopped: boolean;
    }
  | { readonly ok: false; readonly message: string };

export interface Printed {
  readonly stdout: string;
  readonly stderr: string;
}

const unformatted = (file: string, source: string): Finding => ({
  fixable: true,
  message: "The file is not formatted. `rope fix` formats it.",
  path: file,
  range: { start: { column: 1, line: 1 } },
  rule: UNFORMATTED_RULE,
  severity: "error",
  source,
});

/** The findings stderr holds: one for each file that did not parse. */
const parseErrors = (stderr: string, source: string): Finding[] =>
  [...stderr.matchAll(PARSE_ERROR)].flatMap(({ groups }) =>
    groups?.file === undefined
      ? []
      : [
          {
            fixable: false,
            message: groups.message ?? "The file does not parse.",
            path: groups.file,
            range: {
              start: {
                column: Number(groups.column),
                line: Number(groups.line),
              },
            },
            rule: PARSE_RULE,
            severity: "error" as const,
            source,
          },
        ]
  );

/**
 * The lines of a list of files. A file name can start or end with a space,
 * so only the line ending is taken off.
 */
export const linesOf = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line !== "");

/** The files a writing run could not write, each with the reason it gave. */
export const writeFailures = (stderr: string): Map<string, string> =>
  new Map(
    [...stderr.matchAll(WRITE_ERROR)].flatMap(({ groups }) =>
      groups?.file === undefined
        ? []
        : [[groups.file, groups.reason ?? "no reason given"] as const]
    )
  );

/**
 * Reads one run that lists the files that need formatting. Each line of
 * stdout is such a file. A line or an error for a file the run was not
 * given makes the whole run unusable: it would otherwise be dropped unseen.
 */
export const parseOutput = (
  printed: Printed,
  context: { readonly paths: readonly string[]; readonly source: string }
): Parsed => {
  const files = new Map<string, Finding[]>(
    context.paths.map((file) => [file, []])
  );
  const found = [
    ...parseErrors(printed.stderr, context.source),
    ...linesOf(printed.stdout).map((file) => unformatted(file, context.source)),
  ];
  for (const finding of found) {
    const mine = files.get(finding.path);
    if (mine === undefined) {
      return {
        message: `it named ${finding.path}, which it was not given`,
        ok: false,
      };
    }
    mine.push(finding);
  }
  return { files, ok: true, stopped: STOPPED.test(printed.stderr) };
};

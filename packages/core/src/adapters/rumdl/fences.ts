import type { Finding } from "../../contracts/finding.ts";

/**
 * What rumdl 0.3.5 prints on stderr, with `on-error = "warn"`, when a tool it
 * ran on a fenced block failed: `Warning: <file>:<line>: [<tool>] <output>`.
 * The tool's output may run over several lines.
 */
const HEADER = /^Warning: (?<file>.+):(?<line>\d+): \[[^\]]+\] (?<rest>.*)$/u;

/**
 * The formatter read the block from stdin under the name `_`, so an error
 * placed in `_.ts` or `_.jsx` is an error in the block itself: it does not
 * parse. An error placed anywhere else is the formatter failing to run.
 */
const IN_BLOCK = /^\s*at _\.[a-z]+:\d+:\d+\s*$/mu;
const ERROR = /^error: (?<text>.+)$/mu;
/**
 * The formatter's own message, at the start of a line. A line of the block
 * that holds the same words is printed behind a `N |` gutter and is not it.
 */
const CONFIG = /^error: Cannot load the configuration file/mu;

/**
 * The rule a block that does not parse is reported under. It is Ropes's own
 * name: rumdl prints a warning for such a block and gives it no rule.
 */
export const PARSE_RULE = "code-block-parse";

export type Fences =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly message: string };

/** The fence warnings of one run, file by file. */
export type FencesRun =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Fences> }
  | { readonly ok: false; readonly message: string };

interface Warned {
  /** The path as it was given on the command line. */
  readonly file: string;
  readonly line: number;
  readonly body: string;
}

/** Splits stderr into one entry per fence warning. Other text is left out. */
const warnings = (stderr: string): Warned[] => {
  const found: { file: string; line: number; body: string[] }[] = [];
  let open = false;
  for (const text of stderr.split("\n")) {
    const header = HEADER.exec(text)?.groups;
    if (header !== undefined) {
      found.push({
        body: [header.rest ?? ""],
        file: header.file ?? "",
        line: Number(header.line),
      });
      open = true;
    } else if (text.startsWith("Warning: ")) {
      open = false;
    } else if (open) {
      found.at(-1)?.body.push(text);
    }
  }
  return found.map(({ body, file, line }) => ({
    body: body.join("\n"),
    file,
    line,
  }));
};

const detailOf = (warned: Warned): string =>
  ERROR.exec(warned.body)?.groups?.text ?? "no message";

const problem = (warned: Warned): string => {
  if (CONFIG.test(warned.body)) {
    return `the formatter's config did not load, so the fenced block at line ${warned.line} was not checked. Are the repository's dependencies installed?`;
  }
  return `it could not check the fenced block at line ${warned.line}: ${detailOf(warned)}`;
};

const forFile = (
  path: string,
  warned: readonly Warned[],
  source: string
): Fences => {
  const byLine = new Map<number, Finding>();
  for (const one of warned) {
    if (CONFIG.test(one.body) || !IN_BLOCK.test(one.body)) {
      return { message: problem(one), ok: false };
    }
    byLine.set(one.line, {
      fixable: false,
      message: `Code block does not parse, so it was not formatted: ${detailOf(one)}`,
      path,
      range: { start: { column: 1, line: one.line } },
      rule: PARSE_RULE,
      severity: "error",
      source,
    });
  }
  return { findings: [...byLine.values()], ok: true };
};

/**
 * Reads the fence warnings of one run, for each file it was given. A block
 * that does not parse is a finding at the line the block starts on. Any other
 * failure means the formatter did not do its work on that file, so the file
 * has no usable result. A warning about a file the run was not given makes
 * the whole run unusable.
 */
export const readFences = (
  stderr: string,
  context: { readonly paths: readonly string[]; readonly source: string }
): FencesRun => {
  const all = warnings(stderr);
  const asked = new Set(context.paths);
  const stray = all.find((warned) => !asked.has(warned.file));
  if (stray !== undefined) {
    return {
      message: `it warned about ${stray.file}, which it was not given`,
      ok: false,
    };
  }
  return {
    files: new Map(
      context.paths.map((path) => [
        path,
        forFile(
          path,
          all.filter((warned) => warned.file === path),
          context.source
        ),
      ])
    ),
    ok: true,
  };
};

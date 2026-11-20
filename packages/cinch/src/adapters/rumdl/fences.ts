import type { Unchecked } from "../../contracts/result.ts";

/**
 * What rumdl 0.3.5 prints on stderr, with `on-error = "warn"`, when a tool it
 * ran on a fenced block failed: `Warning: <file>:<line>: [<tool>] <output>`.
 * The tool's output may run over several lines.
 */
const HEADER = /^Warning: .+:(?<line>\d+): \[[^\]]+\] (?<rest>.*)$/u;

/**
 * The formatter read the block from stdin under the name `_`, so an error
 * placed in `_.ts` or `_.jsx` is an error in the block itself: it does not
 * parse. An error placed anywhere else is the formatter failing to run.
 */
const IN_BLOCK = /^\s*at _\.[a-z]+:\d+:\d+\s*$/mu;
const ERROR = /^error: (?<text>.+)$/mu;
const CONFIG = "Cannot load the configuration file";

export type Fences =
  | { readonly ok: true; readonly unchecked: readonly Unchecked[] }
  | { readonly ok: false; readonly message: string };

interface Warned {
  readonly line: number;
  readonly body: string;
}

/** Splits stderr into one entry per fence warning. Other text is left out. */
const warnings = (stderr: string): Warned[] => {
  const found: { line: number; body: string[] }[] = [];
  let open = false;
  for (const text of stderr.split("\n")) {
    const header = HEADER.exec(text)?.groups;
    if (header !== undefined) {
      found.push({ body: [header.rest ?? ""], line: Number(header.line) });
      open = true;
    } else if (text.startsWith("Warning: ")) {
      open = false;
    } else if (open) {
      found.at(-1)?.body.push(text);
    }
  }
  return found.map(({ body, line }) => ({ body: body.join("\n"), line }));
};

const detailOf = (warned: Warned): string =>
  ERROR.exec(warned.body)?.groups?.text ?? "no message";

const problem = (warned: Warned): string => {
  if (warned.body.includes(CONFIG)) {
    return `the formatter's config did not load, so the fenced block at line ${warned.line} was not checked. Are the repository's dependencies installed?`;
  }
  return `it could not check the fenced block at line ${warned.line}: ${detailOf(warned)}`;
};

/**
 * Reads the fence warnings of one run. A block that does not parse is left
 * unchecked and named. Any other failure means the formatter did not do its
 * work, so the run is not usable as a result.
 */
export const readFences = (stderr: string): Fences => {
  const byLine = new Map<number, Unchecked>();
  for (const warned of warnings(stderr)) {
    if (warned.body.includes(CONFIG) || !IN_BLOCK.test(warned.body)) {
      return { message: problem(warned), ok: false };
    }
    byLine.set(warned.line, {
      line: warned.line,
      reason: `the fenced block does not parse, so it was not formatted: ${detailOf(warned)}`,
    });
  }
  return { ok: true, unchecked: [...byLine.values()] };
};

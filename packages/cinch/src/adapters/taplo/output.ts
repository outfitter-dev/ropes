import type { Finding, Position } from "../../contracts/finding.ts";

/**
 * Taplo 0.10 has no machine-readable output. It prints each problem on stderr
 * as a headline, then the place it points at:
 *
 *     error: invalid TOML
 *       ┌─ /repo/mise.toml:2:5
 *       │
 *     2 │ b =
 *       │     ^ expected value
 */
const HEADLINE = /^error: (?<message>.+)$/u;
const PLACE = /^\s*┌─ .*:(?<line>\d+):(?<column>\d+)$/u;
const LABEL = /\^+ (?<label>.+)$/u;

/** What Taplo calls every document that does not parse. */
const SYNTAX_MESSAGE = "invalid TOML";

/**
 * The line Taplo logs once it has chosen its files. `total` counts the files
 * it was given, and `excluded` the ones its own config then left out.
 */
const COLLECTED = /found files total=(?<total>\d+) excluded=(?<excluded>\d+)/u;

interface Block {
  readonly message: string;
  readonly lines: readonly string[];
}

const blocksOf = (stderr: string): Block[] => {
  const blocks: { message: string; lines: string[] }[] = [];
  for (const line of stderr.split("\n")) {
    const message = HEADLINE.exec(line)?.groups?.message;
    if (message === undefined) {
      blocks.at(-1)?.lines.push(line);
    } else {
      blocks.push({ lines: [], message });
    }
  }
  return blocks;
};

const labelOf = (block: Block): string | undefined =>
  block.lines.flatMap((line) => LABEL.exec(line)?.groups?.label ?? [])[0];

const placeOf = (block: Block): Position | undefined => {
  for (const line of block.lines) {
    const found = PLACE.exec(line)?.groups;
    if (found?.line !== undefined && found.column !== undefined) {
      return { column: Number(found.column), line: Number(found.line) };
    }
  }
  return undefined;
};

export type Parsed =
  | { readonly ok: true; readonly findings: readonly Finding[] }
  | { readonly ok: false; readonly message: string };

/**
 * Turns what Taplo printed about one file into findings. A document that does
 * not parse is reported under `syntax`, with what the parser expected. Any
 * other problem comes from the schema the file is checked against. A problem
 * with no place is not usable as a finding, so the whole output is refused.
 */
export const parseOutput = (
  stderr: string,
  context: { readonly path: string; readonly source: string }
): Parsed => {
  const findings: Finding[] = [];
  for (const block of blocksOf(stderr)) {
    const place = placeOf(block);
    if (place === undefined) {
      return { message: `it gave no place for "${block.message}"`, ok: false };
    }
    const syntax = block.message === SYNTAX_MESSAGE;
    const label = labelOf(block);
    findings.push({
      fixable: false,
      message:
        syntax && label !== undefined
          ? `${block.message}: ${label}`
          : block.message,
      path: context.path,
      range: {
        start: place,
      },
      rule: syntax ? "syntax" : "schema",
      severity: "error",
      source: context.source,
    });
  }
  return { findings, ok: true };
};

/** How many files Taplo says it read. Undefined when it did not say. */
export const filesRead = (stderr: string): number | undefined => {
  const found = COLLECTED.exec(stderr)?.groups;
  return found?.total === undefined || found.excluded === undefined
    ? undefined
    : Number(found.total) - Number(found.excluded);
};

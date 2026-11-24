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
 * Taplo checks in stages and stops at the first that fails: the document
 * parses, its keys and tables agree, then it fits its schema. Only the last
 * stage is about a schema, and Taplo names the stage when it gives up.
 */
const STAGE = /invalid file error=(?<stage>.+?) path=/u;
const SCHEMA_STAGE = "schema validation failed";

/**
 * The rule of the stage Taplo gave up at. Undefined when it did not name one:
 * the file is valid, or Taplo dropped the line, which it does now and then.
 */
export const ruleOf = (stderr: string): "schema" | "syntax" | undefined => {
  const stage = STAGE.exec(stderr)?.groups?.stage;
  if (stage === undefined) {
    return undefined;
  }
  return stage === SCHEMA_STAGE ? "schema" : "syntax";
};

/** Taplo warns, then carries on with no config, when it cannot use its own. */
const CONFIG_REFUSED = /^\s*WARN taplo:load_config: (?<problem>.+)$/mu;

/**
 * The line Taplo logs once it has chosen its files. `total` counts the files
 * it was given, and `excluded` the ones its own config then left out.
 */
const COLLECTED =
  /found files total=(?<total>\d+) excluded=(?<excluded>\d+) files=\[(?<files>.*)\] cwd=/u;

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
 * Turns what Taplo printed about one file into findings. A document that is
 * not sound TOML is reported under `syntax`: one that does not parse, with
 * what the parser expected, or one whose keys or tables conflict. A problem
 * is reported under `schema` only when Taplo got as far as the schema. A
 * problem with no place is not usable as a finding, so the whole output is
 * refused. So is one that names no stage: the rule would be a guess.
 */
export const parseOutput = (
  stderr: string,
  context: { readonly path: string; readonly source: string }
): Parsed => {
  const findings: Finding[] = [];
  const rule = ruleOf(stderr);
  for (const block of blocksOf(stderr)) {
    const place = placeOf(block);
    if (place === undefined) {
      return { message: `it gave no place for "${block.message}"`, ok: false };
    }
    if (rule === undefined) {
      return { message: "it did not say which check failed", ok: false };
    }
    const label = labelOf(block);
    findings.push({
      fixable: false,
      message:
        block.message === SYNTAX_MESSAGE && label !== undefined
          ? `${block.message}: ${label}`
          : block.message,
      path: context.path,
      range: {
        start: place,
      },
      rule,
      severity: "error",
      source: context.source,
    });
  }
  return { findings, ok: true };
};

/**
 * Whether Taplo says it read exactly this one file. Undefined when it did not
 * say what it read. The file is named by the end of its path, since Taplo
 * prints the full path it resolved. Taplo prints the separators of the
 * system it runs on, doubled where they are backslashes, and a plan path
 * always uses a forward slash, so both are read as one.
 */
export const readOnly = (stderr: string, file: string): boolean | undefined => {
  const found = COLLECTED.exec(stderr)?.groups;
  if (found?.total === undefined || found.excluded === undefined) {
    return undefined;
  }
  return (
    Number(found.total) - Number(found.excluded) === 1 &&
    (found.files ?? "").replaceAll(/\\+/gu, "/").endsWith(`/${file}"`)
  );
};

/** What Taplo said was wrong with its own config. Undefined when nothing. */
export const configProblem = (stderr: string): string | undefined =>
  CONFIG_REFUSED.exec(stderr)?.groups?.problem;

import {
  commentsIn,
  renamed,
  sectionsOf,
  takeComments,
  textOf,
} from "./scan.ts";
import type { Line } from "./scan.ts";
import { unitOf } from "./sort.ts";
import { isTable, parsed } from "./tables.ts";

/** The setting a line states by itself, or undefined when it is not one. */
const unitOfLine = (
  table: readonly string[],
  text: string
): string | undefined => {
  const names = [...table];
  let value: unknown = parsed(text);
  while (isTable(value) && names.length < 2) {
    const keys = Object.keys(value);
    const [key] = keys;
    if (key === undefined || keys.length > 1) {
      return undefined;
    }
    names.push(key);
    value = value[key];
  }
  const whole = names.length === 2 || (names.length === 1 && !isTable(value));
  return whole ? unitOf(...names) : undefined;
};

const EXTENDS = unitOf("extends");

/**
 * The text of a config a person wrote, as tables under `family`, with its
 * comments where they were. The `extends` line and every setting in `units`
 * are left out. `lost` holds each comment that went with one of those.
 */
export const blockOf = (
  text: string,
  units: ReadonlySet<string>,
  family: string
): { readonly text: string; readonly lost: readonly string[] } => {
  const out: Line[] = [];
  const lost: string[] = [];
  for (const section of sectionsOf(text)) {
    const names = section.header?.name.split(".") ?? [];
    const [first, second] = names;
    const whole = [...section.lead, ...section.body];
    if (
      first !== undefined &&
      second !== undefined &&
      units.has(unitOf(first, second))
    ) {
      lost.push(...commentsIn(whole));
    } else {
      const body: Line[] = [];
      for (const line of section.body) {
        const unit =
          line.kind === "key" ? unitOfLine(names, line.text) : undefined;
        if (unit !== undefined && units.has(unit)) {
          lost.push(...takeComments(body));
        } else if (unit !== EXTENDS || names.length > 0) {
          body.push(line);
        }
      }
      const holds = body.some(
        (line) => line.kind === "key" || line.kind === "other"
      );
      if (section.header === null) {
        const top: Line[] = holds
          ? [{ kind: "other", text: `[${family}]` }]
          : [];
        out.push(...top, ...body);
      } else if (holds) {
        const name = `${family}.${section.header.raw}`;
        out.push(...section.lead, renamed(section.header, name), ...body);
      } else {
        lost.push(...commentsIn([...section.lead, ...body]));
      }
    }
  }
  return { lost, text: textOf(out) };
};

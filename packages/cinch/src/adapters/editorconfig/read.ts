import { EditorSchema } from "../../contracts/editor.ts";
import type { EditorFacts, EditorSettings } from "../../contracts/editor.ts";

/** What a file a person wrote states, and what the table cannot hold. */
export interface ReadFile {
  readonly settings: EditorSettings;
  /** One line for each thing the `[editor]` table could not take. */
  readonly dropped: readonly string[];
}

/** The file's key on the left, the table's on the right. */
const KEYS: Readonly<Record<string, keyof EditorFacts>> = {
  charset: "charset",
  end_of_line: "end_of_line",
  indent_size: "indent_size",
  indent_style: "indent_style",
  insert_final_newline: "final_newline",
  max_line_length: "line_width",
  trim_trailing_whitespace: "trim_trailing_whitespace",
};

const typed = (value: string): boolean | number | string => {
  if (value === "true" || value === "false") {
    return value === "true";
  }
  return /^\d+$/u.test(value) ? Number(value) : value;
};

interface Section {
  readonly glob: string;
  readonly facts: Record<string, boolean | number | string>;
}

interface Walk {
  readonly sections: Section[];
  readonly dropped: string[];
  readonly comments: number[];
}

const HEADER = /^\[(?<glob>.+)\]$/u;
const PAIR = /^(?<key>[^=]+?)\s*=\s*(?<value>.*)$/u;

/** A pair before the first section. Only `root = true` is what Cinch writes. */
const preamble = (key: string, value: string, walk: Walk): void => {
  if (key !== "root" || value !== "true") {
    walk.dropped.push(`\`${key} = ${value}\` above the first section`);
  }
};

const pair = (line: string, at: number, walk: Walk): void => {
  const found = PAIR.exec(line)?.groups;
  if (found?.key === undefined || found.value === undefined) {
    walk.dropped.push(`line ${at}, which Cinch could not read`);
    return;
  }
  const key = found.key.toLowerCase();
  const value = found.value.toLowerCase();
  const section = walk.sections.at(-1);
  if (section === undefined) {
    preamble(key, value, walk);
    return;
  }
  const name = KEYS[key];
  const fact = name === undefined ? undefined : { [name]: typed(value) };
  if (name === undefined || !EditorSchema.safeParse(fact).success) {
    walk.dropped.push(`\`${key} = ${value}\` in \`[${section.glob}]\``);
    return;
  }
  section.facts[name] = typed(value);
};

const walked = (text: string): Walk => {
  const walk: Walk = { comments: [], dropped: [], sections: [] };
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    const line = raw.trim();
    const glob = HEADER.exec(line)?.groups?.glob;
    if (line.startsWith("#") || line.startsWith(";")) {
      walk.comments.push(index + 1);
    } else if (glob !== undefined) {
      walk.sections.push({ facts: {}, glob });
    } else if (line !== "") {
      pair(line, index + 1, walk);
    }
  }
  return walk;
};

/**
 * Reads a hand-written file into the shape of the `[editor]` table. The
 * sections for every file become the base facts, and each other section
 * becomes an override. Whatever the table cannot hold is listed and left out:
 * a key it does not know, a value it does not allow, a glob it cannot state,
 * a section for every file that comes after a narrower one, and comments.
 */
export const readFile = (text: string): ReadFile => {
  const walk = walked(text);
  const dropped = [...walk.dropped];
  const base: Record<string, boolean | number | string> = {};
  const overrides: Record<string, unknown>[] = [];
  for (const section of walk.sections) {
    const override = { ...section.facts, files: [section.glob] };
    if (Object.keys(section.facts).length === 0) {
      // Nothing to carry. What it held is already listed.
    } else if (section.glob === "*" && overrides.length === 0) {
      Object.assign(base, section.facts);
    } else if (
      section.glob === "*" ||
      !EditorSchema.safeParse({ overrides: [override] }).success
    ) {
      dropped.push(
        section.glob === "*"
          ? "a `[*]` section below a narrower one, where it wins over that one"
          : `the section \`[${section.glob}]\`, whose glob the table cannot state`
      );
    } else {
      overrides.push(override);
    }
  }
  if (walk.comments.length > 0) {
    dropped.push(`the comments on lines ${walk.comments.join(", ")}`);
  }
  const settings = EditorSchema.parse({
    ...base,
    ...(overrides.length === 0 ? {} : { overrides }),
  });
  return { dropped, settings };
};

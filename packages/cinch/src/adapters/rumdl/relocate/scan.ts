/** One line of a TOML file, told apart without reading its value. */
export type Line =
  | {
      readonly kind: "blank" | "comment" | "key" | "other";
      readonly text: string;
    }
  | {
      readonly kind: "header";
      readonly text: string;
      readonly open: string;
      readonly close: string;
      /** The table's name as written. */
      readonly raw: string;
      /** The name with no spaces in it. */
      readonly name: string;
      /** What follows the closing bracket, such as a comment. */
      readonly tail: string;
    };

export type Header = Extract<Line, { kind: "header" }>;

const HEADER =
  /^\s*(?<open>\[\[?)\s*(?<raw>[^[\]#]+?)\s*(?<close>\]\]?)(?<tail>\s*(?:#.*)?)$/u;
const KEY = /^\s*(?:[\w-]+|"[^"]*"|'[^']*')\s*[.=]/u;

const lineOf = (text: string): Line => {
  if (text.trim() === "") {
    return { kind: "blank", text };
  }
  if (text.trimStart().startsWith("#")) {
    return { kind: "comment", text };
  }
  const found = HEADER.exec(text)?.groups;
  if (found !== undefined && found.open?.length === found.close?.length) {
    const { close = "", open = "", raw = "", tail = "" } = found;
    return {
      close,
      kind: "header",
      name: raw.replaceAll(/\s+/gu, ""),
      open,
      raw,
      tail,
      text,
    };
  }
  return { kind: KEY.test(text) ? "key" : "other", text };
};

/** A table header with the comment right above it and the lines below. */
export interface Section {
  readonly lead: readonly Line[];
  /** Null for the lines before the first header. */
  readonly header: Header | null;
  readonly body: readonly Line[];
}

/**
 * The file as sections. This is a reading by line, not a parse: a caller
 * checks what it builds from it by parsing the result.
 */
export const sectionsOf = (text: string): Section[] => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const sections: { lead: Line[]; header: Header | null; body: Line[] }[] = [
    { body: [], header: null, lead: [] },
  ];
  for (const line of lines.map(lineOf)) {
    const body: Line[] = sections.at(-1)?.body ?? [];
    if (line.kind === "header") {
      let cut = body.length;
      while (body[cut - 1]?.kind === "comment") {
        cut -= 1;
      }
      sections.push({ body: [], header: line, lead: body.splice(cut) });
    } else {
      body.push(line);
    }
  }
  return sections;
};

export const commentsIn = (lines: readonly Line[]): string[] =>
  lines.flatMap((line) => (line.kind === "comment" ? [line.text.trim()] : []));

/** The comment lines that end `lines`, taken off it. */
export const takeComments = (lines: Line[]): string[] => {
  let cut = lines.length;
  while (lines[cut - 1]?.kind === "comment") {
    cut -= 1;
  }
  return commentsIn(lines.splice(cut));
};

/** The lines as text, with no blank line at either end. */
export const textOf = (lines: readonly Line[]): string =>
  lines
    .map((line) => line.text)
    .join("\n")
    .replace(/^\n+/u, "")
    .trimEnd();

export const renamed = (header: Header, name: string): Line => ({
  ...header,
  kind: "other",
  text: `${header.open}${name}${header.close}${header.tail}`,
});

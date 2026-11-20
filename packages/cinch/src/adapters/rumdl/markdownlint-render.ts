import type { Sections, Translated } from "./markdownlint-translate.ts";

export const comment = (lines: readonly string[]): string =>
  lines.map((line) => `# ${line}\n`).join("");

/** The tables as TOML, with the engine's own settings first. */
export const body = (sections: Sections): string => {
  const names = Object.keys(sections).toSorted((left, right) =>
    left.localeCompare(right)
  );
  const ordered = Object.fromEntries(
    [
      ...names.filter((name) => name === "global"),
      ...names.filter((name) => name !== "global"),
    ].map((name) => [name, sections[name]])
  );
  return `${Bun.TOML.stringify(ordered).trim()}\n`;
};

/** The text below the `extends` line. Empty when there is nothing to say. */
export const render = (
  file: string,
  result: Pick<Translated, "notes" | "sections">
): string => {
  const differs = Object.keys(result.sections).length > 0;
  const parts = [
    differs
      ? `${comment([
          `Carried over from ${file} by Cinch.`,
          "Only what differs from the Markdown standard is here.",
        ])}${body(result.sections)}`
      : "",
    result.notes.length > 0
      ? comment([
          `Not carried over from ${file}:`,
          ...result.notes.map((note) => `- ${note}`),
        ])
      : "",
  ];
  return parts
    .filter((part) => part !== "")
    .map((part) => `\n${part}`)
    .join("");
};

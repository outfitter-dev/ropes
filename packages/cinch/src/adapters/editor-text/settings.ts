import type { EditorFacts, EditorSettings } from "../../contracts/editor.ts";

/** Match section globs using basename matching and slash-crossing double stars. */
const matches = (glob: string, file: string): boolean => {
  if (glob.split("/").includes("..")) {
    return false;
  }
  const rooted = glob.includes("/") ? glob : `**/${glob}`;
  const pattern = rooted.replace(/^\//u, "").replaceAll("**", "{*,**/**/**}");
  return new Bun.Glob(pattern).match(file);
};

/** Each matching section replaces only the facts it states, in source order. */
export const settingsFor = (
  settings: EditorSettings,
  file: string
): EditorFacts => {
  const { check: _check, overrides = [], ...base } = settings;
  const facts = { ...base };
  for (const { files, ...values } of overrides) {
    if (files.some((glob) => matches(glob, file))) {
      Object.assign(facts, values);
    }
  }
  return facts;
};

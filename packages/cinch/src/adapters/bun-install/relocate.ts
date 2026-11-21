import path from "node:path";

import { InstallSchema } from "../../contracts/install.ts";
import type { ConfigText, Relocates, Relocation } from "../relocation.ts";
import { BUNFIG, MARK, readInstall, render, tableOf } from "./read.ts";

const Table = InstallSchema.optional();
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stated = (config: ConfigText): unknown => {
  let at: unknown = Bun.TOML.parse(config.text);
  for (const key of [...config.prefix.split("."), "install"].filter(Boolean)) {
    at = record(at) ? at[key] : undefined;
  }
  return at;
};

/** An explicit adoption returns all writes only after lossless validation. */
const adopt = async (root: string, config: ConfigText): Promise<Relocation> => {
  const file = Bun.file(path.join(root, BUNFIG));
  if (!(await file.exists())) {
    return { ok: false, reasons: [`There is no ${BUNFIG} here to adopt.`] };
  }
  const text = await file.text();
  try {
    const settings = readInstall(text);
    const previous = Table.parse(stated(config));
    const generated = { path: BUNFIG, text: render(settings) };
    if (text.startsWith(MARK) && text === generated.text) {
      return { files: [], notes: [], ok: true };
    }
    if (previous !== undefined && render(previous) !== generated.text) {
      return {
        ok: false,
        reasons: [
          `The install table in ${config.file} conflicts with ${BUNFIG}.`,
        ],
      };
    }
    return {
      files: [
        ...(previous === undefined
          ? [
              {
                path: config.file,
                text: `${config.text.trimEnd()}\n\n${tableOf(settings, config.prefix).join("\n")}`,
              },
            ]
          : []),
        generated,
      ],
      notes: [
        "Adoption replaces the install-only file and its comments with generated policy.",
      ],
      ok: true,
    };
  } catch {
    return {
      ok: false,
      reasons: [
        `${BUNFIG} has settings the install table cannot hold or could not be read. Keep the authored file and configure install policy manually.`,
      ],
    };
  }
};

export const installRelocates: Relocates = {
  adopt,
  eject: (_root, config) =>
    Promise.resolve({
      ok: false,
      reasons: [
        `To keep ${BUNFIG} authored, remove the install table from ${config.file} and the generated header from ${BUNFIG}.`,
      ],
    }),
};

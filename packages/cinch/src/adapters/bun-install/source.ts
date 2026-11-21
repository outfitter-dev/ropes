import path from "node:path";

import type { MigrationSource } from "../adapter.ts";
import { BUNFIG, MARK, readInstall, tableOf } from "./read.ts";

/** A first config inherits only an installer file it can represent completely. */
export const installSource: MigrationSource = {
  id: "bun-install",
  inherits: async (root) => {
    const file = Bun.file(path.join(root, BUNFIG));
    if (!(await file.exists())) {
      return null;
    }
    const text = await file.text();
    if (text.startsWith(MARK)) {
      return null;
    }
    try {
      return {
        exclude: [],
        from: BUNFIG,
        include: [],
        keeps: [BUNFIG],
        kinds: [],
        notes: [],
        tables: tableOf(readInstall(text)),
      };
    } catch {
      return {
        exclude: [],
        from: BUNFIG,
        include: [],
        kinds: [],
        notes: [
          `${BUNFIG} has settings the install table cannot hold. It stays authored.`,
        ],
      };
    }
  },
};

import path from "node:path";

import type { InstallSettings } from "../../contracts/install.ts";
import type { Adapter } from "../adapter.ts";
import { managedAdapter } from "../managed.ts";
import type { ManagedFile, Wanted } from "../managed.ts";
import { BUNFIG, authoredAgrees, isGenerated, render } from "./read.ts";
import { installRelocates } from "./relocate.ts";
import { renovateFiles } from "./renovate.ts";
import { installSource } from "./source.ts";

const want = (text: string | null, settings: InstallSettings): Wanted => {
  const generated = render(settings);
  if (text === null || isGenerated(text)) {
    return { ok: true, text: generated };
  }
  try {
    return authoredAgrees(text, settings)
      ? { ok: true, text }
      : {
          message:
            "The authored bunfig.toml disagrees with [install]. Update the shared native values in place or preview `rope preset adopt install`.",
          ok: false,
        };
  } catch {
    return {
      message:
        "The authored bunfig.toml could not be read for install policy comparison.",
      ok: false,
      unknown: true,
    };
  }
};

export const bunInstallAdapter = (settings?: InstallSettings): Adapter => {
  const create = (extra: readonly ManagedFile[] = [], authored = false) =>
    managedAdapter({
      enabledBy: "install.file",
      files:
        settings === undefined
          ? []
          : [
              {
                ...(authored ? { layer: "root" } : {}),
                path: BUNFIG,
                want: (text) => Promise.resolve(want(text, settings)),
              },
              ...extra,
            ],
      id: "bun-install",
      migrates: [installSource],
      moves: { files: [BUNFIG], name: "install" },
      relocates: installRelocates,
    });
  const adapter = create();
  return {
    ...adapter,
    settled: async (root) => {
      if (settings === undefined) {
        return { adapter, ok: true };
      }
      const file = Bun.file(path.join(root, BUNFIG));
      const text = (await file.exists()) ? await file.text() : null;
      return {
        adapter: create(
          await renovateFiles(root, settings),
          text !== null && !isGenerated(text)
        ),
        ok: true,
      };
    },
  };
};

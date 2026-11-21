import type { InstallSettings } from "../../contracts/install.ts";
import type { Adapter } from "../adapter.ts";
import { managedAdapter } from "../managed.ts";
import type { ManagedFile, Wanted } from "../managed.ts";
import { BUNFIG, MARK, authoredAgrees, readInstall, render } from "./read.ts";
import { installRelocates } from "./relocate.ts";
import { renovateFiles } from "./renovate.ts";
import { installSource } from "./source.ts";

const want = (text: string | null, settings: InstallSettings): Wanted => {
  const generated = render(settings);
  if (text === null || text.startsWith(MARK)) {
    return { ok: true, text: generated };
  }
  try {
    return render(readInstall(text)) === generated
      ? {
          ok: true,
          text: generated,
          why: "This install-only file matches [install]. Run `cinch doctor --fix` to generate it.",
        }
      : {
          message:
            "The authored bunfig.toml conflicts with [install]. Run `cinch preset adopt install` to inspect it.",
          ok: false,
        };
  } catch {
    try {
      return authoredAgrees(text, settings)
        ? { ok: true, text }
        : {
            message:
              "The authored bunfig.toml disagrees with [install]. Update the shared native values in place.",
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
  }
};

export const bunInstallAdapter = (settings?: InstallSettings): Adapter => {
  const create = (extra: readonly ManagedFile[] = []) =>
    managedAdapter({
      enabledBy: "install.file",
      files:
        settings === undefined
          ? []
          : [
              {
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
    settled: async (root) => ({
      adapter:
        settings === undefined
          ? adapter
          : create(await renovateFiles(root, settings)),
      ok: true,
    }),
  };
};

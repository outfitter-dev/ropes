import type { MigrationSource } from "../../../adapter.ts";
import { chosenFiles } from "./files.ts";
import { retired } from "./retire.ts";
import type { Setup } from "./retire.ts";

/**
 * The old Markdown linter's config, as a source the Markdown preset takes
 * over from. `setup` says where the carried rules will land. It is read when
 * the source is asked, not when the adapter is made.
 */
export const markdownlintSource = (
  setup: () => Promise<Omit<Setup, "root">>
): MigrationSource => ({
  id: "markdownlint",
  inherits: chosenFiles,
  retires: async (root) => await retired({ ...(await setup()), root }),
});

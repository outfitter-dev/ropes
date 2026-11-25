import { CONFIG_MIGRATION_GUIDE } from "../config/legacy.ts";
import type { SCHEMA_VERSION } from "../contracts/plan.ts";

interface ManagedMove {
  readonly from: string;
  readonly to: string;
}

interface RootReference extends ManagedMove {
  readonly path: string;
}

/** The shape returned by previous pilot versions. */
export interface MigrationPreview {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly source: { readonly path: string; readonly table?: string };
  readonly target: { readonly path: string; readonly text: string };
  readonly managedFiles: readonly ManagedMove[];
  readonly rootReferences: readonly RootReference[];
  readonly recovery: string;
}

/** Manual guidance keeps the API explicit without loading retired policy. */
export const manualMigration = () => ({
  error: `Manual migration required. Move the policy from cinch.toml or [cinch] in outfitter.toml to rope.toml. Preserve unrelated tables in outfitter.toml. Remove the retired policy inputs and .outfitter/configs before running rope. Regenerate managed files under .ropes/configs and update root tool references. Guide: ${CONFIG_MIGRATION_GUIDE}`,
  ok: false as const,
});

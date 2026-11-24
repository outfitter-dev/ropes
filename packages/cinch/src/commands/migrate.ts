import type { SCHEMA_VERSION } from "../contracts/plan.ts";
import type { Operation } from "./command.ts";
import type { CommandDeps } from "./prepare.ts";

interface ManagedMove {
  readonly from: string;
  readonly to: string;
}

interface RootReference extends ManagedMove {
  readonly path: string;
}

export interface MigrationPreview {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly source: { readonly path: string; readonly table?: string };
  readonly target: { readonly path: string; readonly text: string };
  readonly managedFiles: readonly ManagedMove[];
  readonly rootReferences: readonly RootReference[];
  readonly recovery: string;
}

/** Manual guidance keeps the API explicit without loading retired policy. */
export const runMigrationPreview = (
  _cwd: string,
  _deps: CommandDeps
): Promise<Operation<MigrationPreview>> =>
  Promise.resolve({
    error:
      "Manual migration required. Move the policy from cinch.toml or [cinch] in outfitter.toml to rope.toml. Regenerate managed files under .ropes/configs and update root tool references. Remove the legacy config source and .outfitter/configs before running rope. Preserve unrelated tables in outfitter.toml.",
    ok: false,
  });

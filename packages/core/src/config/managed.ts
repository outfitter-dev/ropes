import { ROPES_MANAGED_DIR } from "../contracts/managed-config.ts";
import type { ManagedDir } from "../contracts/managed-config.ts";

export const managedDirFor = (_file: string | null): ManagedDir =>
  ROPES_MANAGED_DIR;

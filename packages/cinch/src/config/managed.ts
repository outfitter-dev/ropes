import {
  CINCH_MANAGED_DIR,
  ROPES_MANAGED_DIR,
} from "../contracts/managed-config.ts";
import type { ManagedDir } from "../contracts/managed-config.ts";
import { ROPES_FILE } from "./load.ts";

export const managedDirFor = (file: string | null): ManagedDir =>
  file === ROPES_FILE ? ROPES_MANAGED_DIR : CINCH_MANAGED_DIR;

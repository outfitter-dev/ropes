import type { FixRequest } from "./command.ts";

export interface PresetRequest extends Omit<FixRequest, "at"> {
  readonly action?: string;
  readonly yes?: boolean;
}

import type { PresetResponse } from "../contracts/preset.ts";
import { renderFix } from "./fix.ts";
import { renderPresets } from "./preset.ts";
import { renderRelocate } from "./relocate.ts";

export const renderPresetResponse = (
  response: PresetResponse,
  json: boolean,
  command: "cinch" | "rope" = "cinch"
): string => {
  if (json) {
    return JSON.stringify(response.report, null, 2);
  }
  if (response.kind === "list") {
    return renderPresets(response.report, command);
  }
  if (response.kind === "move") {
    return renderRelocate(response.report, command);
  }
  return renderFix(response.report);
};

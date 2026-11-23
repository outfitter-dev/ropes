import type { PresetRequest } from "./preset-operation.ts";

/** The public command names one preset at a time and uses the current policy. */
export const presetOptionProblem = (
  request: PresetRequest
): string | undefined => {
  if ("at" in request && request.at !== undefined) {
    return "An explicit evaluation time is only for explain, check, and policy snapshot.";
  }
  const action = request.action ?? "list";
  const names = request.paths.length;
  if (["add", "adopt", "eject"].includes(action) && names !== 1) {
    return `Name exactly one preset to ${action}. Run \`rope preset\` to see them.`;
  }
  if (["list", "update"].includes(action) && names > 1) {
    return `Name at most one preset to ${action}.`;
  }
  return undefined;
};

/** Preserve the legacy diagnostic while making the public recovery runnable. */
export const ropesPresetAdvice = (text: string): string =>
  text
    .replaceAll("`cinch doctor --fix`", "`rope doctor --fix`")
    .replaceAll("`cinch doctor`", "`rope doctor`");

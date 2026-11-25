import { delegationConflict } from "../policy/delegates.ts";
import { filesUnder } from "./files.ts";
import type { Prepared, PrepareResult } from "./prepare.ts";

/** Configuration conflicts remain errors under a partial selection. */
export const validatePreparedDelegation = async (
  value: Prepared
): Promise<PrepareResult> => {
  const { config, plan, present, root } = value;
  if (
    (config.delegates ?? []).length === 0 ||
    !config.overrides.some((override) =>
      override.settings.some((setting) => setting.value === true)
    )
  ) {
    return { ok: true, value };
  }
  const error = delegationConflict(config, [
    ...new Set([
      ...present,
      ...plan.paths.map((entry) => entry.path),
      ...(await filesUnder(root, "")),
    ]),
  ]);
  return error === undefined ? { ok: true, value } : { error, ok: false };
};

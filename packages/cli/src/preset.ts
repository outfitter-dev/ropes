import { preset } from "@ropes/core";
import type { ReadRequest } from "@ropes/core";
import { renderPresetResponse } from "@ropes/core/render";

import { fail, print } from "./output.ts";

export const presetCommand = async (
  request: ReadRequest,
  options: {
    readonly dryRun: boolean;
    readonly yes: boolean;
    readonly json: boolean;
  }
): Promise<number> => {
  const [action = "list", ...names] = request.paths;
  const ran = await preset({
    ...request,
    action,
    dryRun: options.dryRun,
    paths: names,
    yes: options.yes,
  });
  if (!ran.ok) {
    return fail(ran.error, options.json);
  }
  print(renderPresetResponse(ran.value, options.json, "rope"));
  return ran.value.exitCode;
};

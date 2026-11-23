import { exitCodeOf, init } from "@ropes/core";
import type { ReadRequest } from "@ropes/core";
import { renderFix, renderFixJson } from "@ropes/core/render";

import { fail, print } from "./output.ts";

export const initialize = async (
  request: ReadRequest,
  values: { readonly "dry-run"?: boolean; readonly yes?: boolean },
  json: boolean
): Promise<number> => {
  if (request.paths.length > 0) {
    return fail(
      "init sets up the whole repository, so it takes no paths.",
      json
    );
  }
  const ran = await init({
    cwd: request.cwd,
    dryRun: values["dry-run"] === true,
    strict: request.strict === true,
    yes: values.yes === true,
  });
  if (!ran.ok) {
    return fail(ran.error, json);
  }
  const report = ran.value;
  const hint =
    report.dryRun && report.changed.length > 0
      ? "\n\nRun `rope init --yes` to write this setup."
      : "";
  print(json ? renderFixJson(report) : renderFix(report) + hint);
  return exitCodeOf(report.result);
};

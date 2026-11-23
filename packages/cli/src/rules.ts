import { EXIT_CODE, rules, rulesAdopt } from "@ropes/core";
import type { ReadRequest } from "@ropes/core";
import { renderAdopt, renderRules } from "@ropes/core/render";

import { fail, print } from "./output.ts";

export const rulesCommand = async (
  request: ReadRequest,
  values: { readonly "dry-run"?: boolean; readonly yes?: boolean },
  json: boolean
): Promise<number> => {
  const [action = "list", ...packs] = request.paths;
  if (action === "adopt") {
    const ran = await rulesAdopt({
      ...request,
      dryRun: values["dry-run"] === true,
      paths: packs,
      yes: values.yes === true,
    });
    if (!ran.ok) {
      return fail(ran.error, json);
    }
    print(json ? JSON.stringify(ran.value, null, 2) : renderAdopt(ran.value));
    return ran.value.stopped === undefined
      ? EXIT_CODE.clean
      : EXIT_CODE.findings;
  }
  if (action !== "list" || packs.length > 0) {
    return fail("Use rope rules list or rope rules adopt [pack...].", json);
  }
  if (values.yes === true || values["dry-run"] === true) {
    return fail("--yes and --dry-run are only for rules adopt.", json);
  }
  const ran = await rules({ ...request, paths: [] });
  if (!ran.ok) {
    return fail(ran.error, json);
  }
  print(
    json
      ? JSON.stringify(ran.value.report, null, 2)
      : renderRules(ran.value.report, ran.value.config, "rope")
  );
  return EXIT_CODE.clean;
};

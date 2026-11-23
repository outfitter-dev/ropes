import { EXIT_CODE, explain, explainRule, trace } from "@ropes/core";
import type { ReadRequest } from "@ropes/core";
import {
  renderPlan,
  renderPlanJson,
  renderRuleExplanation,
  renderTrace,
} from "@ropes/core/render";

import { fail, print } from "./output.ts";

export const showExplanation = async (
  request: ReadRequest,
  json: boolean,
  detailed: boolean,
  rule?: string
): Promise<number> => {
  if (rule !== undefined) {
    const result = await explainRule({ ...request, rule, trace: detailed });
    if (!result.ok) {
      return fail(result.error, json);
    }
    print(
      json
        ? JSON.stringify(result.value, null, 2)
        : renderRuleExplanation(result.value)
    );
    return EXIT_CODE.clean;
  }
  if (detailed) {
    const traced = await trace(request);
    if (!traced.ok) {
      return fail(traced.error, json);
    }
    print(
      json ? JSON.stringify(traced.value, null, 2) : renderTrace(traced.value)
    );
    return EXIT_CODE.clean;
  }
  const ran = await explain(request, !json);
  if (!ran.ok) {
    return fail(ran.error, json);
  }
  const { plan } = ran.value;
  print(json ? renderPlanJson(plan) : renderPlan(plan, ran.value));
  return EXIT_CODE.clean;
};

import type { AdapterDescriptor } from "../adapters/adapter.ts";
import { compileGlobs } from "./glob.ts";
import type { Matcher } from "./glob.ts";

/** The declared file scope shipped with a rule. */
export const ruleScope = (
  descriptor: AdapterDescriptor | undefined,
  rule: string
): Matcher => {
  const scope = descriptor?.ruleScopes?.[rule];
  const includes =
    scope?.files === undefined ? () => true : compileGlobs(scope.files);
  const ignores = compileGlobs(scope?.ignores ?? []);
  return (file) => includes(file) && !ignores(file);
};

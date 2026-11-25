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

/** The files an enabled shipped rewrite may write. */
export const rewriteScope = (
  descriptor: AdapterDescriptor,
  active: readonly string[]
): Matcher | undefined => {
  const rules = new Set(active);
  const scopes = (descriptor.packs ?? []).flatMap((pack) =>
    (pack.fixable ?? []).flatMap((name) => {
      const id = `${pack.name}/${name}`;
      return rules.has(id) ? [ruleScope(descriptor, id)] : [];
    })
  );
  return scopes.length === 0
    ? undefined
    : (file) => scopes.some((matches) => matches(file));
};

import type { AdapterDescriptor } from "../adapters/adapter.ts";
import type { RopesConfig } from "../contracts/config.ts";
import { DomainSchema } from "../contracts/delegation.ts";
import type { Delegated, Domain } from "../contracts/delegation.ts";
import { compileGlobs } from "./glob.ts";

/** Compile the authored globs once for every selected path in a plan. */
export const delegatedScope = (config: RopesConfig) => {
  const delegates = (config.delegates ?? []).map((delegate) => ({
    domains: delegate.domains ?? DomainSchema.options,
    matches: compileGlobs(delegate.paths),
    source: delegate.source,
    tool: delegate.tool,
  }));
  return (path: string): Delegated[] =>
    delegates
      .filter(({ matches }) => matches(path))
      .map(({ domains, source, tool }) => ({ domains, source, tool }));
};

/** Exact listed config paths always stay authored, independently of domain scope. */
export const protectedAt = (config: RopesConfig, path: string) =>
  (config.delegates ?? [])
    .filter((delegate) => delegate.config?.includes(path) === true)
    .map(({ source, tool }) => ({ source, tool }));

export const domainsOf = (descriptor: AdapterDescriptor): Domain[] => {
  const primary = DomainSchema.safeParse(descriptor.enabledBy.split(".")[0]);
  return [
    ...new Set([
      ...(primary.success ? [primary.data] : []),
      ...(descriptor.formats === true || descriptor.fallbackFormat === true
        ? [DomainSchema.enum.format]
        : []),
    ]),
  ];
};

export const delegatedAdapter = (
  descriptor: AdapterDescriptor,
  delegated: readonly Delegated[]
): boolean =>
  delegated.some(({ domains }) =>
    domainsOf(descriptor).some((domain) => domains.includes(domain))
  );

/** Explicitly enabling an overridden domain cannot silently defeat delegation. */
export const delegationConflict = (
  config: RopesConfig,
  paths: readonly string[]
): string | undefined => {
  if ((config.delegates ?? []).length === 0) {
    return undefined;
  }
  const overrides = config.overrides
    .map((override) => ({
      matches: compileGlobs(override.paths),
      settings: override.settings.filter((setting) => setting.value === true),
    }))
    .filter((override) => override.settings.length > 0);
  const at = delegatedScope(config);
  for (const path of paths) {
    const delegated = at(path);
    for (const override of overrides) {
      if (!override.matches(path)) {
        continue;
      }
      for (const setting of override.settings) {
        const domain = DomainSchema.safeParse(setting.key.split(".")[0]);
        const owner = delegated.find(
          (delegate) => domain.success && delegate.domains.includes(domain.data)
        );
        if (owner !== undefined) {
          return `${config.file ?? "the config"}: ${setting.source.kind === "file" ? setting.source.key : setting.key} explicitly enables ${domain.data} on ${path}, which is delegated to ${owner.tool} by ${owner.source.key}. Remove one of these settings.`;
        }
      }
    }
  }
  return undefined;
};

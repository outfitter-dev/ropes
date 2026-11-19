import { semver } from "bun";

import type { Adapter } from "../adapters/adapter.ts";

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const threw = (what: string, error: unknown): string =>
  `${what} threw: ${describe(error)}`;

const versionProblem = (
  adapter: Adapter,
  version: string | undefined
): string | undefined => {
  const { tool, versionRange } = adapter.descriptor;
  if (versionRange === "*") {
    return undefined;
  }
  if (version === undefined) {
    return `${tool} did not report a version, and ${versionRange} is required`;
  }
  return semver.satisfies(version, versionRange)
    ? undefined
    : `${tool} ${version} does not satisfy ${versionRange}`;
};

/**
 * Why an adapter cannot run here, or `undefined` when it can. Every reason
 * makes its steps incomplete: an adapter that cannot run has checked nothing.
 */
export const notReady = async (
  adapter: Adapter,
  platform: string
): Promise<string | undefined> => {
  const { platforms, tool } = adapter.descriptor;
  if (!platforms.some((supported) => supported === platform)) {
    return `${tool} does not run on ${platform}`;
  }
  try {
    const probe = await adapter.probe();
    return probe.available
      ? versionProblem(adapter, probe.version)
      : (probe.reason ?? `${tool} is not available`);
  } catch (error) {
    return threw(`probing ${tool}`, error);
  }
};

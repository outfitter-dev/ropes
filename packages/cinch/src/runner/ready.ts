import { semver } from "bun";

import type { Adapter } from "../adapters/adapter.ts";

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const threw = (what: string, error: unknown): string =>
  `${what} threw: ${describe(error)}`;

/** What one probe of an adapter found. A `problem` means it cannot run here. */
export interface Readiness {
  readonly problem?: string;
  readonly version?: string | undefined;
}

/** Whether the adapter's tool can run on this platform, and at which version. */
export const probeAdapter = async (
  adapter: Adapter,
  platform: string
): Promise<Readiness> => {
  const { platforms, tool } = adapter.descriptor;
  if (!platforms.some((supported) => supported === platform)) {
    return { problem: `${tool} does not run on ${platform}` };
  }
  try {
    const probe = await adapter.probe();
    return probe.available
      ? { version: probe.version }
      : { problem: probe.reason ?? `${tool} is not available` };
  } catch (error) {
    return { problem: threw(`probing ${tool}`, error) };
  }
};

/**
 * Why the installed version does not meet a range, or `undefined` when it
 * does. The range comes from the plan step, so a run holds the tool to what
 * the plan showed, whatever the registry says now.
 */
export const versionProblem = (
  tool: string,
  version: string | undefined,
  versionRange: string
): string | undefined => {
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

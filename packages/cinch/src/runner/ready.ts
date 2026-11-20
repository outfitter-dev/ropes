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

/**
 * Whether the adapter's tool can run on this platform, and at which version.
 * `root` is the repository the run is for.
 */
export const probeAdapter = async (
  adapter: Adapter,
  platform: string,
  root?: string
): Promise<Readiness> => {
  const { platforms, tool } = adapter.descriptor;
  if (!platforms.some((supported) => supported === platform)) {
    return { problem: `${tool} does not run on ${platform}` };
  }
  try {
    const probe = await adapter.probe(root);
    return probe.available
      ? { version: probe.version }
      : { problem: probe.reason ?? `${tool} is not available` };
  } catch (error) {
    return { problem: threw(`probing ${tool}`, error) };
  }
};

const EXACT = /^\d+\.\d+\.\d+$/u;

/** True when `version` is above an exact pin and inside the wider range. */
const newerWithin = (
  version: string,
  pin: string,
  tolerates: string | undefined
): boolean =>
  tolerates !== undefined &&
  EXACT.test(pin) &&
  semver.order(version, pin) === 1 &&
  semver.satisfies(version, tolerates);

/**
 * Why the installed version does not meet a range, or `undefined` when it
 * does. The range comes from the plan step, so a run holds the tool to what
 * the plan showed, whatever the registry says now. When the step tolerates a
 * wider range, a tool newer than the pin and inside that range is no problem.
 */
export const versionProblem = (
  tool: string,
  version: string | undefined,
  versionRange: string,
  tolerates?: string
): string | undefined => {
  if (versionRange === "*") {
    return undefined;
  }
  if (version === undefined) {
    return `${tool} did not report a version, and ${versionRange} is required`;
  }
  return semver.satisfies(version, versionRange) ||
    newerWithin(version, versionRange, tolerates)
    ? undefined
    : `${tool} ${version} does not satisfy ${versionRange}`;
};

/**
 * What to tell the person when a tool newer than its pin was let through.
 * `undefined` when the tool meets the pin, or when it does not run at all.
 */
export const versionNotice = (
  tool: string,
  version: string | undefined,
  versionRange: string,
  tolerates?: string
): string | undefined =>
  version !== undefined &&
  !semver.satisfies(version, versionRange) &&
  newerWithin(version, versionRange, tolerates)
    ? `${tool} ${version} is newer than the pinned ${versionRange}. It is inside the tested range ${tolerates}, so it ran. In CI or with --strict this is incomplete.`
    : undefined;

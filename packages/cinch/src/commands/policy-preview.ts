import path from "node:path";

import { PolicySnapshotSchema } from "../contracts/policy-preview.ts";
import type {
  PolicyPreview,
  PolicySnapshot,
} from "../contracts/policy-preview.ts";
import { comparePolicy, sameSelection } from "../policy/compare-policy.ts";
import { policySnapshot } from "../policy/policy-snapshot.ts";
import type { Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

export const capturePolicy = async (
  request: ReadRequest,
  deps: CommandDeps,
  artifactVersion: string
): Promise<Operation<PolicySnapshot>> => {
  const prepared = await prepare(request, deps, true);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, config, plan, present } = prepared.value;
  return {
    ok: true,
    value: policySnapshot({
      artifactVersion,
      config,
      descriptors: adapters.map(({ descriptor }) => descriptor),
      plan,
      present,
    }),
  };
};

const read = async (
  cwd: string,
  file: string
): Promise<Operation<PolicySnapshot>> => {
  try {
    const raw: unknown = await Bun.file(path.resolve(cwd, file)).json();
    const snapshot = PolicySnapshotSchema.safeParse(raw);
    if (!snapshot.success) {
      const problems = snapshot.error.issues.map(
        ({ message, path: at }) => `${at.join(".") || "snapshot"}: ${message}`
      );
      return {
        error: `${file}: invalid policy snapshot. ${problems.join(". ")}`,
        ok: false,
      };
    }
    return { ok: true, value: snapshot.data };
  } catch (error) {
    return {
      error: `Could not read policy snapshot ${file}: ${error instanceof Error ? error.message : String(error)}`,
      ok: false,
    };
  }
};

export const previewPolicy = async (
  cwd: string,
  before: string,
  after: string
): Promise<Operation<PolicyPreview>> => {
  const [old, next] = await Promise.all([read(cwd, before), read(cwd, after)]);
  if (!old.ok) {
    return old;
  }
  if (!next.ok) {
    return next;
  }
  if (!sameSelection(old.value, next.value)) {
    return {
      error:
        "Policy snapshots must select the same workspace or explicit paths.",
      ok: false,
    };
  }
  return {
    ok: true,
    value: comparePolicy(old.value, next.value, [before, after]),
  };
};

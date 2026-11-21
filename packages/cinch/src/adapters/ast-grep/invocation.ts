import path from "node:path";

import type { PlannedInvocation } from "../../contracts/trace.ts";
import type { StepInput } from "../adapter.ts";
import { shippedRules } from "./rules.ts";

export const inlineRules = (
  input: StepInput,
  local: readonly string[]
): string =>
  [shippedRules(input.rules), ...local]
    .filter((text) => text !== "")
    .join("\n---\n");

/** The same argument data is used for description and execution. */
export const scanInvocation = (
  binary: string,
  input: StepInput,
  rules: string
): PlannedInvocation => ({
  argv: [
    binary,
    "scan",
    "--inline-rules",
    rules,
    "--json=compact",
    ...input.paths,
  ],
  cwd: input.root,
});

/** Missing kept files have no contents to scan. Their keeper reports them. */
export const existingPaths = async (input: StepInput): Promise<string[]> => {
  const present = await Promise.all(
    input.paths.map((file) => Bun.file(path.join(input.root, file)).exists())
  );
  return input.paths.filter((_, index) => present[index] === true);
};

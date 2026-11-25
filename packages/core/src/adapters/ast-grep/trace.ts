import type { CheckDescriptionResult } from "../../contracts/trace.ts";
import type { StepInput } from "../adapter.ts";
import { chunkPaths } from "../batch.ts";
import { existingPaths, inlineRules, scanInvocation } from "./invocation.ts";
import { readLocal } from "./local.ts";
import type { RuleFolder } from "./local.ts";
import { shippedIds } from "./rules.ts";

/** Reads rule inputs and resolves the executable path, without starting it. */
export const describeScan = async (
  command: string,
  input: StepInput,
  folders: readonly RuleFolder[]
): Promise<CheckDescriptionResult> => {
  const local = await readLocal(input.root, folders, shippedIds);
  if (!local.ok) {
    return { error: local.message, ok: false };
  }
  const paths = await existingPaths(input);
  const binary = Bun.which(command);
  const rules = inlineRules(input, local.texts);
  return {
    ok: true,
    value: {
      invocations:
        rules === ""
          ? []
          : chunkPaths(paths).map((part) =>
              scanInvocation(
                binary ?? command,
                { ...input, paths: part },
                rules
              )
            ),
      limitations: [
        ...(binary === null ? [`${command} is not on PATH.`] : []),
        "No engine was started or its version confirmed. Rule files may further narrow the planned file coverage.",
        "These are the initial invocations. A failed batch may retry files individually.",
      ],
      paths: rules === "" ? [] : paths,
      rules: [
        ...(input.rules ?? []),
        ...[...local.ids].map((id) => `local/${id}`),
      ],
      sources: local.files,
    },
  };
};

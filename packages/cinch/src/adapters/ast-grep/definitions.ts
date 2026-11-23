import { YAML } from "bun";
import { z } from "zod";

import type {
  RuleDefinition,
  RuleDefinitions,
} from "../../contracts/rule-explanation.ts";
import { readLocal } from "./local.ts";
import type { RuleFolder } from "./local.ts";
import { shippedIds, shippedRules } from "./rules.ts";

const Definition = z.object({
  files: z.unknown().optional(),
  id: z.string().min(1),
  ignores: z.unknown().optional(),
  message: z.unknown().optional(),
  metadata: z.unknown().optional(),
});

const definitionsIn = (
  text: string,
  source: string,
  local: boolean
): RuleDefinition[] => {
  const document: unknown = YAML.parse(text);
  const documents = Array.isArray(document) ? document : [document];
  return documents.map((value) => {
    const rule = Definition.parse(value);
    const metadata = z
      .object({ rationale: z.unknown().optional() })
      .safeParse(rule.metadata);
    const rationale =
      metadata.success && typeof metadata.data.rationale === "string"
        ? metadata.data.rationale
        : undefined;
    return {
      ...(rule.files === undefined || rule.files === null
        ? {}
        : { files: rule.files }),
      id: local ? `local/${rule.id}` : rule.id,
      ...(rule.ignores === undefined || rule.ignores === null
        ? {}
        : { ignores: rule.ignores }),
      ...(typeof rule.message === "string" ? { message: rule.message } : {}),
      ...(rule.metadata === undefined || rule.metadata === null
        ? {}
        : { metadata: rule.metadata }),
      ...(rationale === undefined ? {} : { rationale }),
      source,
    };
  });
};

export const describeRules = async (
  root: string,
  folders: readonly RuleFolder[]
): Promise<RuleDefinitions> => {
  const local = await readLocal(root, folders, shippedIds);
  if (!local.ok) {
    return { error: local.message, ok: false };
  }
  try {
    return {
      ok: true,
      rules: [
        ...[...shippedIds].flatMap((id) =>
          definitionsIn(
            shippedRules([id]),
            `@ropes/core/rules/${id}.yml`,
            false
          )
        ),
        ...local.files.flatMap((file, index) =>
          definitionsIn(local.texts[index] ?? "", file, true)
        ),
      ],
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
};

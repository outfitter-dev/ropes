import type { Plan } from "../contracts/plan.ts";
import { versionNotice } from "./ready.ts";
import type { Readiness } from "./ready.ts";

/** One notice per tool that ran although it is newer than its pin. */
export const noticesFor = async (
  plan: Plan,
  probeOf: (adapter: string) => Promise<Readiness> | undefined
): Promise<string[]> => {
  const notices = await Promise.all(
    plan.batches.map(async (batch) => {
      const found = await probeOf(batch.adapter);
      return found === undefined || found.problem !== undefined
        ? undefined
        : versionNotice(
            batch.tool,
            found.version,
            batch.versionRange,
            batch.tolerates
          );
    })
  );
  return [...new Set(notices.filter((notice) => notice !== undefined))];
};

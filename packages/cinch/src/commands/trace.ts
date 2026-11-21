import type { CheckTrace, TracedBatch } from "../contracts/trace.ts";
import type { Operation, ReadRequest } from "./command.ts";
import { prepare } from "./prepare.ts";
import type { CommandDeps } from "./prepare.ts";

/** Add planned invocation data to the existing resolver's explanation. */
export const runTrace = async (
  request: ReadRequest,
  deps: CommandDeps
): Promise<Operation<CheckTrace>> => {
  const prepared = await prepare(request, deps);
  if (!prepared.ok) {
    return prepared;
  }
  const { adapters, plan, root } = prepared.value;
  const batches = await Promise.all(
    plan.batches.map(async (batch): Promise<TracedBatch> => {
      const adapter = adapters.find(
        ({ descriptor }) => descriptor.id === batch.adapter
      );
      if (adapter?.describeCheck === undefined) {
        return {
          batch,
          description: {
            error: "This adapter does not describe its check invocation yet.",
            ok: false,
          },
        };
      }
      try {
        return {
          batch,
          description: await adapter.describeCheck({
            package: batch.package,
            paths: batch.paths,
            root: plan.root,
            ...(batch.rules === undefined ? {} : { rules: batch.rules }),
          }),
        };
      } catch (error) {
        return {
          batch,
          description: {
            error: error instanceof Error ? error.message : String(error),
            ok: false,
          },
        };
      }
    })
  );
  return {
    ok: true,
    value: {
      batches,
      configFile: root.configFile,
      evidence: "planned",
      plan,
      schemaVersion: plan.schemaVersion,
    },
  };
};

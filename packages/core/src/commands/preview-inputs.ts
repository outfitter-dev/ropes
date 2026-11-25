import type { PreviewInput } from "../adapters/adapter.ts";
import { probeAdapter, versionProblem } from "../runner/ready.ts";
import type { Readiness } from "../runner/ready.ts";
import type { Prepared } from "./prepare.ts";
import { CopyError } from "./scratch.ts";

/** Preview only the batches that execution's platform/version policy accepts. */
export const collectPreviewInputs = async ({
  adapters,
  plan,
  root,
}: Prepared): Promise<PreviewInput[]> => {
  const probes = new Map<string, Promise<Readiness>>();
  const snapshots = await Promise.all(
    plan.batches.map(async (batch) => {
      const adapter = adapters.find(
        ({ descriptor }) => descriptor.id === batch.adapter
      );
      if (
        batch.incomplete !== undefined ||
        adapter?.previewInputs === undefined
      ) {
        return [];
      }
      if (!probes.has(batch.adapter)) {
        probes.set(
          batch.adapter,
          probeAdapter(adapter, process.platform, root.root)
        );
      }
      const found = await probes.get(batch.adapter);
      if (
        found?.problem !== undefined ||
        versionProblem(
          batch.tool,
          found?.version,
          batch.versionRange,
          batch.tolerates
        ) !== undefined
      ) {
        return [];
      }
      try {
        return await adapter.previewInputs({
          package: batch.package,
          paths: batch.paths,
          root: root.root,
          ...(batch.rules === undefined ? {} : { rules: batch.rules }),
          ...(batch.target === undefined ? {} : { target: batch.target }),
        });
      } catch (error) {
        throw new CopyError(`inputs for ${batch.adapter} (${String(error)})`);
      }
    })
  );
  return snapshots.flat();
};

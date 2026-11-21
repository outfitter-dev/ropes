import type { Adapter, StepInput } from "../adapter.ts";
import { allIncomplete, chunkPaths, inChunks } from "../batch.ts";
import { exec } from "../exec.ts";
import { probeOnPath } from "../on-path.ts";
import { heldTo } from "../pins.ts";
import { localInvocation } from "./invocation.ts";
import { readOutput } from "./output.ts";
import { previewInputs } from "./preview.ts";
import { localTargets } from "./targets.ts";

export const SUPPORTED_VERSION = "0.24.2";

const run = (input: StepInput) =>
  inChunks(input, async (part) => {
    const binary = Bun.which("lychee");
    if (binary === null) {
      return allIncomplete(part, "lychee is not on PATH");
    }
    const invocation = localInvocation(binary, part);
    try {
      await localTargets(binary, part);
    } catch (error) {
      return allIncomplete(part, String(error));
    }
    const ran = await exec(invocation.argv, invocation.cwd, invocation.env);
    if (ran.exitCode !== 0 && ran.exitCode !== 2) {
      return allIncomplete(
        part,
        `local link checking failed: ${ran.stderr.trim()}`
      );
    }
    if (ran.stderr.trim() !== "") {
      return allIncomplete(
        part,
        `local link checking was incomplete: ${ran.stderr.trim()}`
      );
    }
    const parsed = readOutput(ran.stdout, part);
    if (!parsed.ok) {
      return allIncomplete(part, parsed.reason);
    }
    return (ran.exitCode === 0) === (parsed.errors === 0)
      ? parsed.outcomes
      : allIncomplete(part, "the local link exit code contradicted its report");
  });
/** Local paths and anchors, with networking disabled in the native engine. */
export const lycheeAdapter = (version?: string): Adapter => ({
  check: run,
  describeCheck: (input) =>
    Promise.resolve({
      ok: true,
      value: {
        invocations: chunkPaths(input.paths).flatMap((paths) => [
          localInvocation(
            Bun.which("lychee") ?? "lychee",
            { ...input, paths },
            true
          ),
          localInvocation(Bun.which("lychee") ?? "lychee", {
            ...input,
            paths,
          }),
        ]),
        limitations: [
          "Only local file links and anchor fragments are checked. Targets must stay within the policy root. Extraction can stop the check before target files are read.",
        ],
        rules: ["local-file", "local-fragment"],
        sources: [],
      },
    }),
  descriptor: {
    ...heldTo(version, SUPPORTED_VERSION),
    enabledBy: "markdown.links",
    extensions: [".md"],
    id: "lychee",
    optIn: true,
    platforms: ["darwin", "linux"],
    tool: "lychee",
    unit: "file",
    writes: false,
  },
  fix: run,
  previewInputs: (input) =>
    previewInputs(Bun.which("lychee") ?? "lychee", input),
  probe: () => probeOnPath("lychee"),
});

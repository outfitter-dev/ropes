import type { EditorSettings } from "../../contracts/editor.ts";
import type { Adapter, StepInput } from "../adapter.ts";
import { allIncomplete } from "../batch.ts";
import { probeOnPath } from "../on-path.ts";
import { heldTo } from "../pins.ts";
import { run } from "./check-run.ts";

const TOOL = "editorconfig-checker";

/** Editor facts are explicitly enabled and fill gaps in formatter ownership. */
export const editorCheckerAdapter = (
  settings?: EditorSettings,
  pin?: string
): Adapter => {
  const check = (input: StepInput) => {
    const binary = Bun.which(TOOL);
    return binary === null || settings === undefined
      ? Promise.resolve(
          allIncomplete(input, `${TOOL} or [editor] is unavailable`)
        )
      : run(binary, input, settings);
  };
  return {
    check,
    descriptor: {
      ...heldTo(pin, "4.0.2"),
      enabledBy: "editor.check",
      extensions: ["*"],
      fallbackFormat: true,
      id: TOOL,
      optIn: true,
      platforms: ["darwin", "linux"],
      tool: TOOL,
      unit: "file",
      writes: false,
    },
    fix: check,
    probe: () => probeOnPath(TOOL),
  };
};

import path from "node:path";

import type { EditorSettings } from "../../contracts/editor.ts";
import type { Finding } from "../../contracts/finding.ts";
import type { Adapter, StepInput } from "../adapter.ts";
import { eachFile } from "../batch.ts";
import { decode } from "./decode.ts";
import { checkLines } from "./lines.ts";
import { settingsFor } from "./settings.ts";

const ID = "editor-text";

/** Shared text facts on selected paths that have no active formatter. */
export const editorTextAdapter = (settings?: EditorSettings): Adapter => {
  const check = (input: StepInput) =>
    eachFile(input, async ({ root, path: file }) => {
      try {
        if (settings === undefined) {
          throw new Error("the editor settings are unavailable");
        }
        const facts = settingsFor(settings, file);
        if (Object.values(facts).every((value) => value === undefined)) {
          return { findings: [], status: "passed" };
        }
        const decoded = decode(
          await Bun.file(path.join(root, file)).bytes(),
          facts.charset
        );
        if (decoded.incomplete !== undefined) {
          throw new Error(decoded.incomplete);
        }
        const problems =
          decoded.text === undefined ? [] : checkLines(decoded.text, facts);
        if (decoded.problem !== undefined) {
          problems.unshift({
            line: 1,
            message: decoded.problem,
            setting: "charset",
          });
        }
        const findings: Finding[] = problems.map(
          ({ line, message, setting }) => ({
            fixable: false,
            message: `[editor] ${setting}: ${message}`,
            path: file,
            range: { start: { column: 1, line } },
            rule: setting,
            severity: "error",
            source: ID,
          })
        );
        return {
          findings,
          status: findings.length === 0 ? "passed" : "findings",
        };
      } catch (error) {
        return {
          findings: [],
          reason: error instanceof Error ? error.message : String(error),
          status: "incomplete",
        };
      }
    });
  return {
    check,
    descriptor: {
      enabledBy: "editor.check",
      extensions: ["*"],
      fallbackFormat: true,
      id: ID,
      optIn: true,
      platforms: ["darwin", "linux", "win32"],
      tool: "rope",
      unit: "file",
      versionRange: "*",
      writes: false,
    },
    fix: check,
    probe: () => Promise.resolve({ available: true }),
  };
};

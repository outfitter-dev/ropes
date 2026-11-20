import { expect } from "bun:test";
import { rm } from "node:fs/promises";
import path from "node:path";

import { DoctorReportSchema } from "../src/contracts/doctor.ts";
import { FixReportSchema } from "../src/contracts/fix.ts";
import { FILES, json, proof } from "./acceptance-repo.ts";

const KEPT = ".outfitter/configs/rumdl.toml";

proof(
  "proof 6: fix leaves the Cinch setup alone, and doctor --fix repairs it",
  async ({ main }) => {
    const exit = async (...args: string[]): Promise<number> => {
      const ran = await main.cinch(args);
      return ran.exitCode;
    };
    // A repository Cinch was never set up in: `fix` writes nothing at all.
    const stopped = await main.cinch(["fix", "--json"]);
    const report = FixReportSchema.parse(json(stopped));
    expect(stopped.exitCode).toBe(1);
    expect(report.changed).toEqual([]);
    expect(report.stopped).toContain("cinch doctor --fix");
    expect(await main.files()).toEqual({ ...FILES });
    expect(await exit("check")).toBe(1);

    const looked = await main.cinch(["doctor"]);
    expect(looked.exitCode).toBe(1);
    expect(looked.stdout).toContain("Run `cinch doctor --fix`");
    expect(await main.files()).toEqual({ ...FILES });

    const repaired = DoctorReportSchema.parse(
      json(await main.cinch(["doctor", "--fix", "--json"]))
    );
    expect(repaired.changed).toEqual([
      ".outfitter/configs/presets/rumdl.toml",
      KEPT,
      ".rumdl.toml",
    ]);
    expect(repaired.tools.map((tool) => tool.tool)).toContain("rumdl");
    expect(await exit("doctor")).toBe(0);
    // The repair touched no file of the repository's own.
    const after = await main.files();
    expect(after["README.md"]).toBe(FILES["README.md"]);

    await rm(path.join(main.root, KEPT));
    const again = await main.cinch(["fix"]);
    expect(again.exitCode).toBe(1);
    expect(again.stdout).toContain("Nothing was fixed");
    const untouched = await main.files();
    expect(untouched["README.md"]).toBe(FILES["README.md"]);
    await main.cinch(["doctor", "--fix"]);
    const restored = await main.files();
    expect(restored[KEPT]).toBe(after[KEPT]);
    expect(await exit("fix")).toBe(0);
  }
);

const rumdl = async (root: string, file: string): Promise<number> => {
  const child = Bun.spawn(["rumdl", "check", "--no-cache", file], {
    cwd: root,
    stderr: "ignore",
    stdout: "ignore",
  });
  return await child.exited;
};

proof(
  "proof 7: a rule set in cinch.toml reaches the engine through doctor --fix",
  async ({ main }) => {
    const exit = async (...args: string[]): Promise<number> => {
      const ran = await main.cinch(args);
      return ran.exitCode;
    };
    await main.cinch(["doctor", "--fix"]);
    const before = await main.cinch(["check", "README.md"]);
    expect(before.stdout).toContain("MD025");
    expect(await rumdl(main.root, "README.md")).toBe(1);

    const stated = `${FILES["cinch.toml"]}\n[tools.rumdl.global]\nextend-disable = ["MD025", "MD082"]\n`;
    await Bun.write(path.join(main.root, "cinch.toml"), stated);
    // Until the setup is repaired, the stale generated config is reported.
    const stale = await main.cinch(["check", "README.md", KEPT]);
    expect(stale.exitCode).toBe(1);
    expect(stale.stdout).toContain("cinch doctor --fix");
    expect(await exit("fix")).toBe(1);

    const repaired = DoctorReportSchema.parse(
      json(await main.cinch(["doctor", "--fix", "--json"]))
    );
    expect(repaired.changed).toEqual([KEPT]);
    // Cinch and the engine run by hand now agree, with no other file edited.
    expect(await exit("check", "README.md")).toBe(0);
    expect(await rumdl(main.root, "README.md")).toBe(0);
  }
);

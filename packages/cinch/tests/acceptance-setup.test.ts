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
    expect(repaired.changed).toEqual([KEPT, ".rumdl.toml"]);
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

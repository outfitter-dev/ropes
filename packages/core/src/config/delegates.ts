import { z } from "zod";

import { DomainSchema } from "../contracts/delegation.ts";
import { Globs } from "./tables.ts";

/** Exact portable root-relative files, with no globs or parent segments. */
const CONFIG_PATH =
  /^(?![A-Za-z]:)(?!(?:[\s\S]*\/)?\.{1,2}(?:\/|(?![\s\S])))[^\\/*?{}\u005B\u005D\p{Cc}]+(?:\/[^\\/*?{}\u005B\u005D\p{Cc}]+)*$/u;

export const DelegatesSchema = z.record(
  z.string().min(1),
  z.strictObject({
    config: z
      .array(
        z
          .string()
          .min(1)
          .regex(
            CONFIG_PATH,
            "must be an exact root-relative file inside the repository"
          )
      )
      .optional()
      .describe("Authored config files Ropes must never write or retire."),
    domains: z
      .array(DomainSchema)
      .min(1)
      .optional()
      .describe("Delegated policy domains. Omit to delegate every domain."),
    paths: Globs.min(1).describe(
      "Root-relative globs for the work this tool owns."
    ),
  })
);

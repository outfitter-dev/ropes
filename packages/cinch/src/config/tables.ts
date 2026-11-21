import { z } from "zod";

import { EnforcementSettingSchema } from "../contracts/enforcement.ts";

/** Whether a root-relative path stays under the root it is read from. */
const isInside = (folder: string): boolean =>
  !/^[\\/]/u.test(folder) &&
  !/^[A-Za-z]:/u.test(folder) &&
  !folder.split(/[\\/]/u).includes("..");

export const Globs = z.array(z.string().min(1));
export const ProfileSchema = z.strictObject({
  enabled: z
    .boolean()
    .optional()
    .describe("Whether Markdown is checked. On unless set to false."),
  preset: z
    .boolean()
    .optional()
    .describe(
      "Whether Cinch keeps the shared Markdown standard in the repository."
    ),
});
export const TomlSchema = z.strictObject({
  enabled: z
    .boolean()
    .optional()
    .describe("Whether TOML is checked. On unless set to false."),
});
/** A shared config that is kept only when the repository asks for it. */
const optInPreset = (what: string) =>
  z.strictObject({
    preset: z
      .boolean()
      .optional()
      .describe(
        `Whether Cinch keeps the shared ${what} in the repository. Off unless set to true.`
      ),
  });
/** The switch for an engine that is off until the repository asks for it. */
const optInSwitch = (what: string) => ({
  enabled: z
    .boolean()
    .optional()
    .describe(`Whether ${what}. Off unless set to true.`),
});
export const RuleSwitchSchema = z.strictObject({
  ...optInSwitch("the structural rules are run"),
  enforcement: z
    .record(z.string().min(1), EnforcementSettingSchema)
    .optional()
    .describe(
      "Enforcement for a shipped rule ID: advisory, blocking, or a UTC deadline (YYYY-MM-DD). Unstated rules retain their blocking behavior."
    ),
});
export const OPT_IN = {
  format: optInPreset("formatter config").extend(
    optInSwitch("files are held to the formatter")
  ),
  lint: optInPreset("lint config").extend(
    optInSwitch("TypeScript and JavaScript are linted")
  ),
  rules: RuleSwitchSchema.extend({
    local: z
      .array(
        z
          .string()
          .min(1)
          .refine(isInside, "must be a folder inside the repository")
      )
      .optional()
      .describe(
        "Root-relative folders of the repository's own rules. They run beside the shipped ones."
      ),
    off: z
      .array(z.string().min(1))
      .optional()
      .describe("Shipped rule packs and rules, by name, that are not run."),
    packs: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "Shipped rule packs, by name, that are run. `cinch rules adopt` writes this."
      ),
  }),
  typescript: optInPreset("TypeScript compiler options").extend(
    optInSwitch("TypeScript is type checked")
  ),
};
export const overrideSwitch = (what: string) =>
  z
    .strictObject({
      enabled: z.boolean().optional().describe(`Whether ${what}.`),
    })
    .optional();

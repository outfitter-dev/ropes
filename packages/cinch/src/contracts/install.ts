import { z } from "zod";

const NUMBER = "(?:0|[1-9]\\d*)";
const IDENTIFIER = `(?:${NUMBER}|\\d*[A-Za-z-][A-Za-z0-9-]*)`;
const VERSION = `${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${IDENTIFIER}(?:\\.${IDENTIFIER})*)?(?:\\+[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*)?`;
const NAME = "(?:@[a-z0-9][a-z0-9_.-]*/)?[a-z0-9][a-z0-9_.-]*";
// Keep the loader and its published JSON Schema on the same version grammar.
const EXEMPT = new RegExp(
  `^${NAME}(?:@${VERSION}(?:\\s*\\|\\|\\s*${VERSION})*)?$`,
  "u"
);

const AGE = /^\d+ (?<unit>seconds?|minutes?|hours?|days?)$/u;

/** Whole seconds, using fixed units so the policy has no calendar ambiguity. */
export const ageSeconds = (age: string): number => {
  if (!AGE.test(age)) {
    return Number.NaN;
  }
  const [amount = "", unit = ""] = age.split(" ");
  const units: Readonly<Record<string, number>> = {
    day: 86_400,
    days: 86_400,
    hour: 3600,
    hours: 3600,
    minute: 60,
    minutes: 60,
    second: 1,
    seconds: 1,
  };
  return Number(amount) * (units[unit] ?? Number.NaN);
};

const Age = z
  .string()
  .regex(AGE)
  .refine(
    (value) => Number.isSafeInteger(ageSeconds(value)),
    "must fit whole seconds"
  );

/** Shared install facts. Native installer settings stay in their own files. */
export const InstallSchema = z.strictObject({
  isolated: z
    .boolean()
    .optional()
    .describe("Whether packages see only their declared dependencies."),
  minimum_release_age: Age.optional().describe(
    "The minimum age of a new release, such as `7 days`."
  ),
  release_age_exempt: z
    .array(
      z
        .string()
        .min(1)
        .regex(
          EXEMPT,
          "must name a package or exact package versions; globs and ranges are unsupported"
        )
    )
    .optional()
    .describe(
      "Explicit package or package-version exceptions to the release age."
    ),
});
export type InstallSettings = z.infer<typeof InstallSchema>;

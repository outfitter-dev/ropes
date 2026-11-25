import type { Plan, Skipped } from "../contracts/plan.ts";
import type { Preset } from "./presets.ts";

/** Why the plan has no step that keeps one of a preset's files. */
export type Gap =
  | { readonly file: string; readonly preset: Preset; readonly why: "off" }
  | {
      readonly file: string;
      readonly preset: Preset;
      readonly why: "protected";
      readonly owner: NonNullable<Plan["paths"][number]["protected"]>[number];
    }
  | {
      readonly file: string;
      readonly preset: Preset;
      readonly skipped: Skipped | undefined;
      readonly why: "left-out";
    };

/**
 * A preset is judged a file at a time: the config can exclude one file while
 * the preset's adapter still keeps the others. A kept file needs no `include`
 * entry while its adapter is on, so one that is in the plan with no step from
 * that adapter, or left out as not included, has had the preset switched off.
 * An excluded file whose preset is off is switched off too: there is nothing
 * to keep there. A preset that is off until the config asks for it is off
 * wherever policy does not set its key to true.
 */
export const gapOf = (preset: Preset, file: string, plan: Plan): Gap | null => {
  const entry = plan.paths.find((planned) => planned.path === file);
  const [owner] = entry?.protected ?? [];
  if (owner !== undefined) {
    return { file, owner, preset, why: "protected" };
  }
  const states = (value: boolean): boolean =>
    entry?.policy.some(
      (setting) => setting.key === preset.enabledBy && setting.value === value
    ) === true;
  const off = preset.optIn ? !states(true) : states(false);
  if (off && entry?.skipped !== undefined) {
    return { file, preset, why: "off" };
  }
  if (!entry || entry.skipped?.reason === "excluded") {
    return { file, preset, skipped: entry?.skipped, why: "left-out" };
  }
  return entry.steps.some((step) => step.adapter === preset.adapter)
    ? null
    : { file, preset, why: "off" };
};

export const gapsOf = (presets: readonly Preset[], plan: Plan): Gap[] =>
  presets.flatMap((preset) =>
    preset.files.flatMap((file) => gapOf(preset, file, plan) ?? [])
  );

/** The setting that left a file out, as a person would look it up. */
export const settingOf = (skipped: Skipped | undefined): string =>
  skipped?.source.kind === "file"
    ? `\`${skipped.source.key}\` in ${skipped.source.file}`
    : "its defaults";

/** What a person reads about a preset that is off. */
const describeOff = (preset: Preset): string => {
  if (!preset.optIn) {
    return `the ${preset.name} preset is switched off: the Ropes config sets \`${preset.enabledBy}\` to false. Remove that line, then run this again.`;
  }
  const [table, key] = preset.enabledBy.split(".");
  return `the ${preset.name} preset is off until the Ropes config asks for it. Set \`${key} = true\` under \`[${table}]\`, then run this again.`;
};

/** What a person reads when a preset file cannot be kept. */
export const describeGap = (gap: Gap): string => {
  if (gap.why === "protected") {
    return `${gap.file} is protected for ${gap.owner.tool} by ${gap.owner.source.file}: ${gap.owner.source.key}. Remove it from that config list before asking Ropes to manage it.`;
  }
  return gap.why === "off"
    ? describeOff(gap.preset)
    : `the Ropes config leaves ${gap.file} out (${settingOf(gap.skipped)}), so the ${gap.preset.name} preset cannot be kept there. Take the file out of that setting, then run this again.`;
};

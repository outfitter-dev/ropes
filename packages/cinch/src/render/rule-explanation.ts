import type { RuleExplanation } from "../contracts/rule-explanation.ts";

export const renderRuleExplanation = (report: RuleExplanation): string =>
  [
    report.rule.id,
    ...(report.rule.message === undefined ? [] : [report.rule.message]),
    ...(report.rule.rationale === undefined ? [] : [report.rule.rationale]),
    `Source: ${report.rule.source}`,
    ...(report.rule.files === undefined
      ? []
      : [`Native files: ${JSON.stringify(report.rule.files)}`]),
    ...(report.rule.ignores === undefined
      ? []
      : [`Native ignores: ${JSON.stringify(report.rule.ignores)}`]),
    ...(report.pack === undefined
      ? []
      : [
          `Pack: ${report.pack.name}`,
          `Adoption: ${report.pack.named === undefined ? "not adopted" : JSON.stringify(report.pack.named)}`,
          ...(report.pack.off === undefined
            ? []
            : [`Pack disabled: ${JSON.stringify(report.pack.off)}`]),
          ...report.pack.rules
            .filter(({ id, off }) => id === report.rule.id && off !== undefined)
            .map(({ off }) => `Rule disabled: ${JSON.stringify(off)}`),
        ]),
    ...(report.evaluation === undefined
      ? []
      : [`Evaluation: ${report.evaluation.at}`]),
    ...(report.paths.length === 0 ? ["No paths were selected."] : []),
    ...report.paths.flatMap(({ path, state }) => [
      `${path.package} / ${path.path}: ${state}`,
      ...path.policy
        .filter(({ key }) => key.startsWith("rules."))
        .map(
          ({ blockingAt, key, source, value }) =>
            `  ${key} = ${value} (${source.kind === "file" ? `${source.file}: ${source.key}` : "default"})${blockingAt === undefined ? "" : `; blocks at ${blockingAt}`}`
        ),
      ...(path.targets ?? []).map(
        (target) => `  Support condition: ${JSON.stringify(target)}`
      ),
      ...(path.skipped === undefined
        ? []
        : [`  ${path.skipped.reason}: ${JSON.stringify(path.skipped.source)}`]),
    ]),
    ...(report.trace ?? []).map(({ batch, description }) =>
      description.ok
        ? [
            `Planned invocation for ${batch.package}`,
            ...description.value.invocations.map(
              ({ argv, cwd }) => `  ${cwd}: ${JSON.stringify(argv)}`
            ),
            ...description.value.limitations.map(
              (limitation) => `  ${limitation}`
            ),
          ].join("\n")
        : `Invocation unavailable: ${description.error}`
    ),
    ...report.limitations,
  ].join("\n");

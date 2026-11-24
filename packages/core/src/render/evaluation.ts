import type { Plan } from "../contracts/plan.ts";

export const evaluationLines = (evaluation: Plan["evaluation"]): string[] =>
  evaluation === undefined
    ? []
    : [
        `${evaluation.simulated ? "Simulated evaluation" : "Evaluated"} at ${evaluation.at}.`,
        ...(evaluation.nextTransitionAt === undefined
          ? []
          : [`Next enforcement transition: ${evaluation.nextTransitionAt}.`]),
      ];

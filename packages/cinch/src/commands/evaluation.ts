import { z } from "zod";

import type { Evaluation } from "../contracts/plan.ts";
import type { Operation } from "./command.ts";

const Instant = z.union([
  z.iso.datetime({ precision: 0 }),
  z.iso.datetime({ precision: 3 }),
]);

export const evaluationAt = (at: string | undefined): Operation<Evaluation> => {
  if (at === undefined) {
    return {
      ok: true,
      value: { at: new Date().toISOString(), simulated: false },
    };
  }
  if (!Instant.safeParse(at).success) {
    return {
      error:
        "Use a UTC instant such as 2027-02-01T00:00:00Z or 2027-02-01T00:00:00.000Z for the evaluation time.",
      ok: false,
    };
  }
  return {
    ok: true,
    value: { at: new Date(at).toISOString(), simulated: true },
  };
};

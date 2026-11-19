import type { Result } from "../contracts/result.ts";

/** The whole result, and nothing else, so stdout stays machine-readable. */
export const renderJson = (result: Result): string =>
  JSON.stringify(result, null, 2);

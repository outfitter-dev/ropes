import { startBundledEngine } from "./adapters/registry.ts";
import { STANDALONE } from "./adapters/shipped-text.ts";
import { configureStandIn } from "./adapters/stand-in.ts";
import { enclosingCheckout, toRootRelative } from "./config/root.ts";

export { STANDALONE } from "./adapters/shipped-text.ts";

/**
 * Configure the embedded runtime, or handle an internal engine worker.
 * The worker rewrites the live argv because its CLI reads process.argv.
 */
export const prepareRuntime = async (
  argv: string[],
  cwd: string
): Promise<boolean> => {
  const worker = startBundledEngine(argv);
  if (worker !== undefined) {
    await worker;
    return true;
  }
  if (STANDALONE) {
    let checkout: Promise<string> | undefined;
    configureStandIn(async (target) => {
      checkout ??= enclosingCheckout(cwd);
      const root = await checkout;
      const location = await toRootRelative(root, root, target);
      return !location.ok;
    });
  }
  return false;
};

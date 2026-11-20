import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  env: { browser: false, node: true },
  extends: [core],
  globals: { Bun: "readonly" },
  ignorePatterns: [...(core.ignorePatterns ?? []), "dist/**", "coverage/**"],
  options: { typeAware: true },
  rules: {
    // A function that has nothing to wait for can still return a promise.
    // This rule wants it marked async, and require-await then rejects the
    // async function for having no await.
    "typescript/promise-function-async": "off",
  },
});

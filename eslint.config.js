import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", ".venv/", "data/", "pipeline/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "no-constant-condition": ["error", { checkLoops: false }],
      // With noUncheckedIndexedAccess on, every typed-array read in the router's hot loops is
      // `T | undefined`. Bounds come from the decoded graph format (checked at load), so `!` is
      // the honest annotation there. See docs/DECISIONS.md (D-014).
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);

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
      // the honest annotation there.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Node scripts (listed by hand rather than adding the `globals` package).
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: Object.fromEntries(
        ["process", "console", "fetch", "setTimeout", "URL", "WebSocket", "Buffer"].map((g) => [g, "readonly"]),
      ),
    },
  },
);

// ESLint flat config for the generator, scripts and tests (TypeScript, strict).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "out/", ".wrangler/", "lakehouse/", "generator/src/contracts/*generated*.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);

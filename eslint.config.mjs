import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "dist/**", "node_modules/**", "coverage/**", "playwright-report/**", "test-results/**", "drizzle/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Les images viennent de fichiers privés servis par l'API : next/image ne convient pas.
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;

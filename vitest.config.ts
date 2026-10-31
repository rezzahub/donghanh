import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) =>
  fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

const resolve = {
  alias: [
    {
      find: /^@donghanh\/core\/skills$/,
      replacement: src("core/src/skills.ts"),
    },
    { find: /^@donghanh\/core$/, replacement: src("core/src/index.ts") },
    { find: /^@donghanh\/config$/, replacement: src("config/src/index.ts") },
  ],
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "node",
          include: ["packages/**/*.test.{ts,tsx}"],
          exclude: ["packages/widget/**", "**/node_modules/**"],
        },
      },
      {
        resolve,
        test: {
          name: "widget",
          environment: "happy-dom",
          include: ["packages/widget/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});

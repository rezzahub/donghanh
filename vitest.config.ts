import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/**/*.test.{ts,tsx}"],
          exclude: ["packages/widget/**", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "widget",
          // Testing Library registers its cleanup through the global afterEach.
          globals: true,
          environment: "happy-dom",
          include: ["packages/widget/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});

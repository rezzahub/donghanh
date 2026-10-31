import { describe, expect, test } from "bun:test";
import { App, buildRegistry } from "@donghanh/core";
import { resolveSystemPrompt } from "./chat";

describe("resolveSystemPrompt", () => {
  test("prefers explicit, then app instructions, then the default", () => {
    const withInstructions = buildRegistry(
      App({ operations: {}, instructions: "Play." }),
    );
    const without = buildRegistry(App({ operations: {} }));

    expect(
      resolveSystemPrompt({ systemPrompt: "Explicit." }, withInstructions),
    ).toBe("Explicit.");
    expect(resolveSystemPrompt({}, withInstructions)).toBe("Play.");
    expect(resolveSystemPrompt({}, without)).toBe(
      "You are a helpful assistant. Use the tools to help the user.",
    );
  });
});

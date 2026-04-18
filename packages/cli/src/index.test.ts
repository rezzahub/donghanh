import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./index";

function tmp() {
  return mkdtempSync(join(tmpdir(), "dh-cli-"));
}

describe("help", () => {
  test("lists dev and build commands", async () => {
    const res = await run(["help"]);
    const text = res.messages.join("\n");
    expect(text).toContain("donghanh dev");
    expect(text).toContain("donghanh build");
  });
});

describe("build", () => {
  test("fails with code 1 when donghanh.config.ts missing", async () => {
    const dir = tmp();
    const res = await run(["build"], { cwd: dir });
    expect(res.code).toBe(1);
    const text = res.messages.join("\n");
    expect(text).toContain("donghanh.config.ts not found");
    expect(text).not.toContain("Unknown command");
  });
});

describe("dev", () => {
  test("fails with code 1 when donghanh.config.ts missing", async () => {
    const dir = tmp();
    const res = await run(["dev"], { cwd: dir });
    expect(res.code).toBe(1);
    const text = res.messages.join("\n");
    expect(text).toContain("donghanh.config.ts not found");
    expect(text).not.toContain("Unknown command");
  });
});

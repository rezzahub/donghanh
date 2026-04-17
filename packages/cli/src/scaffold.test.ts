import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  operationTemplate,
  patchConfigWidget,
  widgetTemplate,
  writeFileSafe,
} from "./scaffold";

function tmp() {
  return mkdtempSync(join(tmpdir(), "dh-cli-"));
}

describe("widgetTemplate", () => {
  test("emits createRoot + DongHanhWidget with appName", () => {
    const t = widgetTemplate("boards");
    expect(t).toContain("createRoot");
    expect(t).toContain(`DongHanhWidget appName="boards"`);
  });
});

describe("operationTemplate", () => {
  test("query op has proper casing", () => {
    const t = operationTemplate("list-boards", "query");
    expect(t).toContain("function ListBoards(");
    expect(t).toContain('id: "list-boards"');
    expect(t).toContain('type: "query"');
    expect(t).toContain('responseKey: "listBoards"');
  });
  test("mutation flag reflected", () => {
    const t = operationTemplate("create-board", "mutation");
    expect(t).toContain('type: "mutation"');
  });
});

describe("writeFileSafe", () => {
  test("writes new file", async () => {
    const dir = tmp();
    const f = join(dir, "a/b/c.txt");
    expect(await writeFileSafe(f, "hello")).toBe("written");
    const content = await readFile(f, "utf8");
    expect(content).toBe("hello");
  });
  test("does not overwrite existing file", async () => {
    const dir = tmp();
    const f = join(dir, "x.txt");
    await writeFileSafe(f, "first");
    expect(await writeFileSafe(f, "second")).toBe("exists");
    const content = await readFile(f, "utf8");
    expect(content).toBe("first");
  });
});

describe("patchConfigWidget", () => {
  test("inserts entry into widgets block", async () => {
    const dir = tmp();
    const cfg = join(dir, "donghanh.config.ts");
    writeFileSync(
      cfg,
      `import { defineConfig } from "@donghanh/config";
export default defineConfig({
  operations: "./operations/**/*.tsx",
  widgets: {
    boards: "./widgets/boards.tsx",
  },
});
`,
    );
    const res = await patchConfigWidget(cfg, "cards", "./widgets/cards.tsx");
    expect(res).toBe("patched");
    const out = await readFile(cfg, "utf8");
    expect(out).toContain(`cards: "./widgets/cards.tsx"`);
    expect(out).toContain(`boards: "./widgets/boards.tsx"`);
  });

  test("skips when entry already present", async () => {
    const dir = tmp();
    const cfg = join(dir, "donghanh.config.ts");
    writeFileSync(
      cfg,
      `export default { widgets: { "cards": "./widgets/cards.tsx" } };`,
    );
    const res = await patchConfigWidget(cfg, "cards", "./widgets/cards.tsx");
    expect(res).toBe("patched");
  });

  test("returns manual when widgets block missing", async () => {
    const dir = tmp();
    const cfg = join(dir, "donghanh.config.ts");
    writeFileSync(cfg, `export default { operations: "./ops/**/*.tsx" };`);
    const res = await patchConfigWidget(cfg, "cards", "./widgets/cards.tsx");
    expect(res).toBe("manual");
  });
});

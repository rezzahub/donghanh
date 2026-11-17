import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { grepFiles } from "./grep";
import { staticFiles } from "./static";
import type { FileContext, FileProvider } from "./types";

const ctx = {} as FileContext;

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("grepFiles", () => {
  it("returns a match with 2 lines of context each side", async () => {
    const p = staticFiles("t", { "d/a.md": "1\n2\n3\nneedle\n5\n6\n7\n" });
    const r = await grepFiles([p], { pattern: "needle", uri: "t://d/" }, ctx);
    expect(r).toEqual({
      hits: [
        {
          uri: "t://d/a.md",
          line: 4,
          text: "needle",
          before: ["2", "3"],
          after: ["5", "6"],
        },
      ],
      capped: false,
    });
  });

  it("honours context 0 and clamps context to the cap", async () => {
    const p = staticFiles("t", { "d/a.md": "1\n2\n3\nneedle\n5\n6\n7\n" });
    const zero = await grepFiles(
      [p],
      { pattern: "needle", uri: "t://d/", context: 0 },
      ctx,
    );
    expect(zero.hits[0]?.before).toEqual([]);
    expect(zero.hits[0]?.after).toEqual([]);
    const big = await grepFiles(
      [p],
      { pattern: "needle", uri: "t://d/", context: 99 },
      ctx,
    );
    expect(big.hits[0]?.before).toEqual(["2", "3"]);
  });

  it("ignoreCase", async () => {
    const p = staticFiles("t", { "d/a.md": "Hello\n" });
    const off = await grepFiles([p], { pattern: "hello", uri: "t://d/" }, ctx);
    expect(off.hits).toHaveLength(0);
    const on = await grepFiles(
      [p],
      { pattern: "hello", uri: "t://d/", ignoreCase: true },
      ctx,
    );
    expect(on.hits).toHaveLength(1);
  });

  it("glob filters files", async () => {
    const p = staticFiles("t", { "d/a.md": "x\n", "d/b.json": "x\n" });
    const r = await grepFiles(
      [p],
      { pattern: "x", uri: "t://d/", glob: "*.json" },
      ctx,
    );
    expect(r.hits.map((h) => h.uri)).toEqual(["t://d/b.json"]);
  });

  it("60 matches with default limit gives 50 hits and capped", async () => {
    const text = `${Array.from({ length: 60 }, () => "m").join("\n")}\n`;
    const p = staticFiles("t", { "d/a.md": text });
    const r = await grepFiles([p], { pattern: "m", uri: "t://d/" }, ctx);
    expect(r.hits).toHaveLength(50);
    expect(r.capped).toBe(true);
  });

  it("exactly limit matches is not capped", async () => {
    const p = staticFiles("t", { "d/a.md": "m\nm\nm\n" });
    const r = await grepFiles(
      [p],
      { pattern: "m", uri: "t://d/", limit: 3 },
      ctx,
    );
    expect(r.hits).toHaveLength(3);
    expect(r.capped).toBe(false);
  });

  it("300 small files: scans at most 200 and is capped", async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 300; i++) {
      tree[`d/f${String(i).padStart(3, "0")}.md`] =
        i === 199 || i === 200 ? "m\n" : "x\n";
    }
    const p = staticFiles("t", tree);
    const r = await grepFiles([p], { pattern: "m", uri: "t://d/" }, ctx);
    expect(r.hits.map((h) => h.uri)).toEqual(["t://d/f199.md"]);
    expect(r.capped).toBe(true);
  });

  it("pages past folder entries to reach 200 files", async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 300; i++) {
      tree[`d/s${String(i).padStart(3, "0")}/f.md`] =
        i === 199 || i === 200 ? "m\n" : "x\n";
    }
    const p = staticFiles("t", tree);
    const r = await grepFiles([p], { pattern: "m", uri: "t://d/" }, ctx);
    expect(r.hits.map((h) => h.uri)).toEqual(["t://d/s199/f.md"]);
    expect(r.capped).toBe(true);
  });

  it("scans at most 2 MB in total across files", async () => {
    const filler = `${"a".repeat(1000)}\n`.repeat(1500);
    const p = staticFiles("t", {
      "d/a.md": `markA\n${filler}`,
      "d/b.md": `markB\n${filler}markB2\n`,
      "d/c.md": `markC\n${filler}`,
    });
    const r = await grepFiles([p], { pattern: "mark", uri: "t://d/" }, ctx);
    expect(r.hits.map((h) => h.text)).toEqual(["markA", "markB"]);
    expect(r.capped).toBe(true);
  });

  it("truncates a single huge file at 2 MB", async () => {
    const filler = `${"a".repeat(1000)}\n`.repeat(2500);
    const p = staticFiles("t", { "d/a.md": `early\n${filler}late\n` });
    const r = await grepFiles(
      [p],
      { pattern: "early|late", uri: "t://d/" },
      ctx,
    );
    expect(r.hits.map((h) => h.text)).toEqual(["early"]);
    expect(r.capped).toBe(true);
  });

  it("truncates on a UTF-8 boundary", async () => {
    const p = staticFiles("t", { "d/a.md": `${"é".repeat(1100000)}\n` });
    const r = await grepFiles([p], { pattern: "\uFFFD", uri: "t://d/" }, ctx);
    expect(r.hits).toEqual([]);
    expect(r.capped).toBe(true);
  });

  it("a total under 2 MB is not capped", async () => {
    const p = staticFiles("t", {
      "d/a.md": `${"a".repeat(1000)}\n`.repeat(1500),
    });
    const r = await grepFiles([p], { pattern: "zzz", uri: "t://d/" }, ctx);
    expect(r.capped).toBe(false);
  });

  it("skips binary entries", async () => {
    const p = staticFiles("t", {
      "d/a.md": "x\n",
      "d/pic.png": { url: "https://x/p.png", mime: "image/png", bytes: 3 },
    });
    const r = await grepFiles([p], { pattern: ".", uri: "t://d/" }, ctx);
    expect(r.hits.map((h) => h.uri)).toEqual(["t://d/a.md"]);
  });

  it("uses a provider-native grep when defined", async () => {
    const base = staticFiles("t", { "d/a.md": "x\n" });
    const grep = vi.fn(async () => [
      { uri: "t://d/a.md", line: 1, text: "x", before: [], after: [] },
    ]);
    const list = vi.spyOn(base, "list");
    const p: FileProvider = { ...base, grep };
    const r = await grepFiles([p], { pattern: "x", uri: "t://d/" }, ctx);
    expect(grep).toHaveBeenCalledWith(
      {
        uri: "t://d/",
        pattern: "x",
        glob: undefined,
        ignoreCase: undefined,
        context: 2,
        limit: 50,
      },
      ctx,
    );
    expect(list).not.toHaveBeenCalled();
    expect(r.hits).toHaveLength(1);
  });

  it("throws Invalid pattern for a bad regex", async () => {
    const p = staticFiles("t", { "d/a.md": "x\n" });
    await expect(
      grepFiles([p], { pattern: "(", uri: "t://d/" }, ctx),
    ).rejects.toThrow(/^Invalid pattern/);
  });

  it("does not find a match that only exists past char 2000", async () => {
    const p = staticFiles("t", {
      "d/a.md": `${"a".repeat(2000)}needle\nneedle ${"a".repeat(3000)}\n`,
    });
    const r = await grepFiles([p], { pattern: "needle", uri: "t://d/" }, ctx);
    expect(r.hits.map((h) => h.line)).toEqual([2]);
    expect(r.hits[0]?.text).toHaveLength(2000);
  });

  it("greps a single file uri", async () => {
    const p = staticFiles("t", { "d/a.md": "x\n", "d/b.md": "x\n" });
    const r = await grepFiles([p], { pattern: "x", uri: "t://d/a.md" }, ctx);
    expect(r.hits.map((h) => h.uri)).toEqual(["t://d/a.md"]);
  });

  it("throws when the uri does not exist", async () => {
    const p = staticFiles("t", { "d/a.md": "x\n" });
    await expect(
      grepFiles([p], { pattern: "x", uri: "t://nope/" }, ctx),
    ).rejects.toThrow(/No file or folder at t:\/\/nope\//);
  });

  it("does not leak a throwing provider's message", async () => {
    const bad: FileProvider = {
      ...staticFiles("t", {}),
      stat: async () => {
        throw new Error("secret-token");
      },
    };
    const err = await grepFiles(
      [bad],
      { pattern: "x", uri: "t://d/" },
      ctx,
    ).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("secret-token");
  });

  describe("a failing provider among several", () => {
    const tree = { "d/a.md": "needle\n" };
    const boom = () => {
      throw new Error("secret-token");
    };
    const noLeak = () =>
      expect(JSON.stringify(errors.mock.calls)).not.toContain("secret-token");

    it("falls back to the good provider when read throws", async () => {
      const bad: FileProvider = { ...staticFiles("t", tree), read: boom };
      const good = staticFiles("t", tree);
      const r = await grepFiles(
        [bad, good],
        { pattern: "needle", uri: "t://d/" },
        ctx,
      );
      expect(r.hits.map((h) => h.uri)).toEqual(["t://d/a.md"]);
      expect(errors).toHaveBeenCalled();
      noLeak();
    });

    it("falls back to the good provider when list throws", async () => {
      const bad: FileProvider = { ...staticFiles("t", tree), list: boom };
      const good = staticFiles("t", tree);
      const r = await grepFiles(
        [bad, good],
        { pattern: "needle", uri: "t://d/" },
        ctx,
      );
      expect(r.hits.map((h) => h.uri)).toEqual(["t://d/a.md"]);
      expect(errors).toHaveBeenCalled();
      noLeak();
    });

    it("falls back to the scan when a native grep throws", async () => {
      const bad: FileProvider = { ...staticFiles("t", tree), grep: boom };
      const good = staticFiles("t", tree);
      const r = await grepFiles(
        [bad, good],
        { pattern: "needle", uri: "t://d/" },
        ctx,
      );
      expect(r.hits.map((h) => h.uri)).toEqual(["t://d/a.md"]);
      expect(errors).toHaveBeenCalled();
      noLeak();
    });
  });
});

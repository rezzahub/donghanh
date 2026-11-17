import { describe, expect, it } from "vitest";
import { chunkMarkdown, describeMarkdown } from "./markdown";

describe("describeMarkdown", () => {
  it("prefers frontmatter description", () => {
    expect(describeMarkdown("---\ndescription: Hi there\n---\n# T\n")).toBe(
      "Hi there",
    );
  });
  it("skips a folded or literal frontmatter description", () => {
    expect(
      describeMarkdown("---\ndescription: >-\n  long\n  text\n---\n# Real\n"),
    ).toBe("Real");
    expect(describeMarkdown("---\ndescription: |\n  x\n---\nbody line\n")).toBe(
      "body line",
    );
  });
  it("falls back to the first heading, then first line", () => {
    expect(describeMarkdown("intro\n# Title\n")).toBe("Title");
    expect(describeMarkdown("\n\nfirst line\nsecond")).toBe("first line");
  });
  it("uses the first heading of any level, without its markup", () => {
    expect(describeMarkdown("## Foo\nbody\n")).toBe("Foo");
    expect(describeMarkdown("intro\n### Bar ###\n# Later\n")).toBe("Bar");
    expect(describeMarkdown("###### Six\n")).toBe("Six");
    expect(describeMarkdown("# C#\n")).toBe("C#");
    expect(describeMarkdown("```\n## no\n```\n## yes\n")).toBe("yes");
    expect(describeMarkdown("####### seven\n")).toBe("####### seven");
  });
  it("ignores headings in code fences", () => {
    expect(describeMarkdown("```\n# no\n```\n# yes\n")).toBe("yes");
  });
  it("cuts at 160 chars and handles empty", () => {
    expect(describeMarkdown("a".repeat(300))).toHaveLength(160);
    expect(describeMarkdown("")).toBe("");
  });
});

describe("chunkMarkdown", () => {
  const doc = "pre\n# A\nx\n```\n# not\n```\n## B\ny";
  it("splits at headings outside fences and covers every line", () => {
    const c = chunkMarkdown(doc, { by: "heading" });
    expect(c.map((k) => [k.from, k.to])).toEqual([
      [1, 1],
      [2, 6],
      [7, 8],
    ]);
    expect(c[0]?.text).toBe("pre");
  });
  it("splits by lines with default size 40", () => {
    const text = Array.from({ length: 90 }, (_, i) => `l${i}`).join("\n");
    expect(chunkMarkdown(text, { by: "lines" }).map((k) => k.to)).toEqual([
      40, 80, 90,
    ]);
    expect(chunkMarkdown(text, { by: "lines", size: 50 })).toHaveLength(2);
  });
  it("returns [] for empty text", () => {
    expect(chunkMarkdown("", { by: "heading" })).toEqual([]);
  });
  it("splits lines like read_file: one blank line for a lone newline, no CR", () => {
    expect(chunkMarkdown("\n", { by: "heading" })).toEqual([
      { from: 1, to: 1, text: "" },
    ]);
    expect(chunkMarkdown("\r\n", { by: "lines" })).toEqual([
      { from: 1, to: 1, text: "" },
    ]);
    expect(chunkMarkdown("# A\r\nx\r\n", { by: "heading" })).toEqual([
      { from: 1, to: 2, text: "# A\nx" },
    ]);
  });
  it("does not count a trailing newline as a line", () => {
    expect(chunkMarkdown("a\n", { by: "heading" })).toEqual([
      { from: 1, to: 1, text: "a" },
    ]);
    const c = chunkMarkdown("a\nb\n", { by: "lines", size: 1 });
    expect(c.map((k) => [k.from, k.to])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(chunkMarkdown("a\nb\n", { by: "heading" }).at(-1)?.to).toBe(2);
  });
  it("handles CRLF and no trailing newline", () => {
    expect(chunkMarkdown("a\r\n", { by: "heading" }).at(-1)?.to).toBe(1);
    const c = chunkMarkdown("# A\r\nx\r\n# B\r\ny\r\n", { by: "heading" });
    expect(c.map((k) => [k.from, k.to])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunkMarkdown("a\nb", { by: "heading" }).at(-1)?.to).toBe(2);
  });
});

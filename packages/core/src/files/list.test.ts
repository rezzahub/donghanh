import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globToRegExp } from "./glob";
import { listFiles } from "./list";
import { firstFrom } from "./route";
import { staticFiles } from "./static";
import type { FileContext, FileProvider } from "./types";

const ctx = {} as FileContext;
const SECRET = "secret-token-xyz";

function thrower(scheme: string, what: "roots" | "all"): FileProvider {
  const boom = async () => {
    throw new TypeError(SECRET);
  };
  return {
    scheme,
    roots: boom,
    stat: what === "all" ? boom : async () => null,
    list: boom,
    read: boom,
  };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("globToRegExp", () => {
  it("handles *, **, ?", () => {
    expect(globToRegExp("*.md").test("a.md")).toBe(true);
    expect(globToRegExp("*.md").test("d/a.md")).toBe(false);
    expect(globToRegExp("**/*.md").test("a.md")).toBe(true);
    expect(globToRegExp("**/*.md").test("d/e/a.md")).toBe(true);
    expect(globToRegExp("a?.md").test("ab.md")).toBe(true);
    expect(globToRegExp("a?.md").test("a/.md")).toBe(false);
    expect(globToRegExp("a.md").test("axmd")).toBe(false);
  });
});

describe("firstFrom", () => {
  it("returns the first non-null among same-scheme providers", async () => {
    const a = staticFiles("s", { "a/x.md": "# X\n" });
    const b = staticFiles("s", { "b/y.md": "# Y\n" });
    const other = staticFiles("o", { "b/y.md": "# O\n" });
    const r = await firstFrom([other, a, b], "s://b/y.md", (p) =>
      p.read("s://b/y.md", ctx),
    );
    expect(r?.text).toBe("# Y\n");
  });
  it("skips a throwing provider and logs only its name", async () => {
    const r = await firstFrom(
      [thrower("s", "all"), staticFiles("s", { "a.md": "hi" })],
      "s://a.md",
      (p) => p.read("s://a.md", ctx),
    );
    expect(r?.text).toBe("hi");
    expect(errors).toHaveBeenCalledWith(
      "[files] provider s failed (TypeError)",
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SECRET);
  });
  it("throws unavailable when every matching provider throws", async () => {
    const err = await firstFrom([thrower("s", "all")], "s://a.md", (p) =>
      p.read("s://a.md", ctx),
    ).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "File providers are unavailable (s); try again.",
    );
  });
  it("throws unavailable when one provider answers null and another throws", async () => {
    const err = await firstFrom(
      [staticFiles("s", { "b.md": "x" }), thrower("s", "all")],
      "s://a.md",
      (p) => p.read("s://a.md", ctx),
    ).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      "File providers are unavailable (s); try again.",
    );
    expect((err as Error).message).not.toContain(SECRET);
  });
  it("returns null when no provider threw and none had it", async () => {
    const r = await firstFrom(
      [thrower("o", "all"), staticFiles("s", { "b.md": "x" })],
      "s://a.md",
      (p) => p.read("s://a.md", ctx),
    );
    expect(r).toBeNull();
  });
});

describe("staticFiles", () => {
  const p = staticFiles("s", {
    "a/x.md": "# Heading\nbody\n",
    "a/sub/y.txt": "one\r\ntwo",
    "b/img.png": { url: "https://x/img.png", mime: "image/png", bytes: 99 },
  });
  it("lists one root dir per first segment", async () => {
    expect((await p.roots?.(ctx))?.map((e) => e.uri)).toEqual([
      "s://a/",
      "s://b/",
    ]);
  });
  it("stat and read return null outside its tree", async () => {
    expect(await p.stat("s://zzz.md", ctx)).toBeNull();
    expect(await p.read("s://zzz.md", ctx)).toBeNull();
    expect(await p.stat("other://a/x.md", ctx)).toBeNull();
  });
  it("describes entries", async () => {
    const md = await p.stat("s://a/x.md", ctx);
    expect(md).toMatchObject({
      kind: "file",
      lines: 2,
      mime: "text/markdown",
      description: "Heading",
      bytes: 15,
    });
    const txt = await p.stat("s://a/sub/y.txt", ctx);
    expect(txt).toMatchObject({ lines: 2, mime: "text/plain" });
    const bin = await p.stat("s://b/img.png", ctx);
    expect(bin).toMatchObject({ kind: "file", mime: "image/png", bytes: 99 });
    expect(bin?.lines).toBeUndefined();
  });
});

describe("listFiles", () => {
  const a = staticFiles("s", {
    "a/x.md": "# X\n",
    "a/sub/y.md": "# Y\n",
    "a/sub/z.txt": "z",
  });
  const b = staticFiles("s", { "b/w.md": "# W\n" });

  it("unions roots and skips a failing provider without leaking", async () => {
    const r = await listFiles([a, thrower("t", "roots"), b], {}, ctx);
    expect(r.entries.map((e) => e.uri)).toEqual(["s://a/", "s://b/"]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(SECRET);
  });
  it("throws when every provider fails", async () => {
    let err: Error | undefined;
    try {
      await listFiles([thrower("t", "roots"), thrower("u", "roots")], {}, ctx);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toBe(
      "File providers are unavailable (t, u); try again.",
    );
    expect(err?.message).not.toContain(SECRET);
  });
  it("lists depth 1 and 2", async () => {
    const d1 = await listFiles([a, b], { uri: "s://a/" }, ctx);
    expect(d1.entries.map((e) => e.uri)).toEqual(["s://a/sub/", "s://a/x.md"]);
    expect(d1.entries[0]?.kind).toBe("dir");
    const d2 = await listFiles([a, b], { uri: "s://a/", depth: 2 }, ctx);
    expect(d2.entries.map((e) => e.uri)).toEqual([
      "s://a/sub/",
      "s://a/sub/y.md",
      "s://a/sub/z.txt",
      "s://a/x.md",
    ]);
  });
  it("filters by glob", async () => {
    const r = await listFiles(
      [a],
      { uri: "s://a/", depth: 5, glob: "**/*.md" },
      ctx,
    );
    expect(r.entries.map((e) => e.uri)).toEqual([
      "s://a/sub/y.md",
      "s://a/x.md",
    ]);
  });
  it("pages with limit, next and after", async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 250; i++)
      tree[`d/f${String(i).padStart(3, "0")}.md`] = "x";
    const p = staticFiles("s", tree);
    const seen: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const r = await listFiles([p], { uri: "s://d/", limit: 100, after }, ctx);
      seen.push(...r.entries.map((e) => e.uri));
      after = r.next;
      pages++;
    } while (after);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(250);
    expect(new Set(seen).size).toBe(250);
  });
  it("clamps limit to 500", async () => {
    const tree: Record<string, string> = {};
    for (let i = 0; i < 600; i++) tree[`d/f${i}.md`] = "x";
    const r = await listFiles(
      [staticFiles("s", tree)],
      { uri: "s://d/", limit: 9999 },
      ctx,
    );
    expect(r.entries).toHaveLength(500);
    expect(r.next).toBeDefined();
  });
  it("an outage of the only provider reads as unavailable, not missing", async () => {
    await expect(
      listFiles([thrower("s", "all")], { uri: "s://a/" }, ctx),
    ).rejects.toThrow("File providers are unavailable (s); try again.");
  });

  it("throws for an unknown uri", async () => {
    await expect(listFiles([a], { uri: "s://nope/" }, ctx)).rejects.toThrow(
      "No file or folder at s://nope/; call list_files with no uri to see the roots.",
    );
  });
  it("answers from each of two providers sharing a scheme", async () => {
    const x = await listFiles([a, b], { uri: "s://b/" }, ctx);
    expect(x.entries.map((e) => e.uri)).toEqual(["s://b/w.md"]);
    const y = await listFiles([b, a], { uri: "s://a/" }, ctx);
    expect(y.entries.map((e) => e.uri)).toContain("s://a/x.md");
  });
});

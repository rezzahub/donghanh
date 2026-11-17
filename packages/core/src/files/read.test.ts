import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "./read";
import { staticFiles } from "./static";
import type { FileContext, FileProvider } from "./types";

const ctx = {} as FileContext;
const numbered = (n: number) =>
  `${Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

const tree = {
  "f/big.md": numbered(500),
  "f/wide.md": `${Array.from({ length: 100 }, () => "x".repeat(400)).join("\n")}\n`,
  "f/giant.md": `${"y".repeat(50000)}\nafter\n`,
  "f/empty.md": "",
  "f/nonl.md": "a\nb\nlast",
  "f/crlf.md": "a\r\nb\r\nc\r\n",
  "docs/a/index.md": "# A\n",
  "docs/a/other.md": "other 1\nother 2\n",
  "docs/a/my notes.md": "spaced\n",
  "docs/a/tài-liệu.md": "vietnamese\n",
  "f/pic.png": { url: "https://x/pic.png", mime: "image/png", bytes: 9 },
};
const p = staticFiles("t", tree);

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("readFile", () => {
  it("default read is the first 200 lines with a next offset", async () => {
    const r = await readFile([p], { uri: "t://f/big.md" }, ctx);
    expect(r.lines).toEqual({ from: 1, to: 200, total: 500 });
    expect(r.truncated).toBe(true);
    expect(r.next).toEqual({ uri: "t://f/big.md", offset: 201 });
    expect(r.kind).toBe("text");
  });

  it("head, tail, offset+limit", async () => {
    const h = await readFile([p], { uri: "t://f/big.md", head: 5 }, ctx);
    expect(h.text).toBe("line 1\nline 2\nline 3\nline 4\nline 5");
    expect(h.next).toEqual({ uri: "t://f/big.md", offset: 6, limit: 5 });
    const t = await readFile([p], { uri: "t://f/big.md", tail: 3 }, ctx);
    expect(t.lines).toEqual({ from: 498, to: 500, total: 500 });
    expect(t.text).toBe("line 498\nline 499\nline 500");
    expect(t.next).toBeUndefined();
    const o = await readFile(
      [p],
      { uri: "t://f/big.md", offset: 100, limit: 10 },
      ctx,
    );
    expect(o.lines).toEqual({ from: 100, to: 109, total: 500 });
    expect(o.next).toEqual({ uri: "t://f/big.md", offset: 110, limit: 10 });
  });

  it("reading to the end has no next", async () => {
    const r = await readFile([p], { uri: "t://f/big.md", offset: 495 }, ctx);
    expect(r.lines).toEqual({ from: 495, to: 500, total: 500 });
    expect(r.next).toBeUndefined();
    expect(r.truncated).toBeFalsy();
  });

  it("offset past the end is empty, not an error", async () => {
    const r = await readFile([p], { uri: "t://f/big.md", offset: 9999 }, ctx);
    expect(r.text).toBe("");
    expect(r.lines?.total).toBe(500);
    expect(r.next).toBeUndefined();
  });

  it("the 16 KB cap stops early and next points at the first unread line", async () => {
    const r = await readFile([p], { uri: "t://f/wide.md" }, ctx);
    const n = (r.lines?.to ?? 0) - (r.lines?.from ?? 0) + 1;
    expect(n).toBeLessThan(100);
    expect(new TextEncoder().encode(r.text ?? "").length).toBeLessThanOrEqual(
      16384,
    );
    expect(r.truncated).toBe(true);
    expect(r.next?.offset).toBe(n + 1);
  });

  it("cuts one 50,000-char line and still advances", async () => {
    const r = await readFile([p], { uri: "t://f/giant.md", head: 1 }, ctx);
    expect(r.text).toBe(`${"y".repeat(2000)}…[line truncated]`);
    expect(r.next?.offset).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.lineCut).toBe(true);
    const all = await readFile([p], { uri: "t://f/giant.md" }, ctx);
    expect(all.lines).toEqual({ from: 1, to: 2, total: 2 });
    expect(all.next).toBeUndefined();
  });

  it("empty file has zero lines", async () => {
    const r = await readFile([p], { uri: "t://f/empty.md" }, ctx);
    expect(r.lines?.total).toBe(0);
    expect(r.text).toBe("");
    expect(r.next).toBeUndefined();
  });

  it("no trailing newline keeps the last line, counts no extra", async () => {
    const r = await readFile([p], { uri: "t://f/nonl.md" }, ctx);
    expect(r.lines).toEqual({ from: 1, to: 3, total: 3 });
    expect(r.text).toBe("a\nb\nlast");
  });

  it("CRLF counts lines and strips the CR", async () => {
    const r = await readFile([p], { uri: "t://f/crlf.md" }, ctx);
    expect(r.lines?.total).toBe(3);
    expect(r.text).toBe("a\nb\nc");
  });

  it("rejects conflicting or missing arguments", async () => {
    const u = "t://f/big.md";
    await expect(
      readFile([p], { uri: u, head: 1, offset: 2 }, ctx),
    ).rejects.toThrow(/together|exclusive/i);
    await expect(
      readFile([p], { uri: u, tail: 1, limit: 2 }, ctx),
    ).rejects.toThrow(/together|exclusive/i);
    await expect(
      readFile([p], { uri: u, head: 1, tail: 1 }, ctx),
    ).rejects.toThrow(/together|exclusive/i);
    await expect(readFile([p], { uri: u, path: "x.md" }, ctx)).rejects.toThrow(
      /both/i,
    );
    await expect(readFile([p], {}, ctx)).rejects.toThrow(/uri/i);
  });

  it("a relative path without base teaches the fix", async () => {
    await expect(readFile([p], { path: "other.md" }, ctx)).rejects.toThrow(
      'Relative path "other.md" needs base — pass the uri of the file that links it (use_skill returns it).',
    );
  });

  it("a path resolves against the base's directory", async () => {
    const r = await readFile(
      [p],
      { path: "other.md", base: "t://docs/a/index.md" },
      ctx,
    );
    expect(r.uri).toBe("t://docs/a/other.md");
    expect(r.text).toBe("other 1\nother 2");
  });

  it("a path with a fragment, %20 or non-ASCII name reads the listed file", async () => {
    const base = "t://docs/a/index.md";
    const read = (path: string) => readFile([p], { path, base }, ctx);
    expect((await read("other.md#part")).uri).toBe("t://docs/a/other.md");
    expect((await read("my%20notes.md")).text).toBe("spaced");
    expect((await read("tài-liệu.md")).text).toBe("vietnamese");
    expect((await read("t%C3%A0i-li%E1%BB%87u.md")).uri).toBe(
      "t://docs/a/tài-liệu.md",
    );
  });

  it("binary returns kind binary and url, no text", async () => {
    const r = await readFile([p], { uri: "t://f/pic.png" }, ctx);
    expect(r.kind).toBe("binary");
    expect(r.url).toBe("https://x/pic.png");
    expect(r.text).toBeUndefined();
  });

  it("missing file throws the not-found message", async () => {
    await expect(readFile([p], { uri: "t://f/nope.md" }, ctx)).rejects.toThrow(
      "No file at t://f/nope.md; call list_files to browse.",
    );
  });

  it("a throwing provider reads as unavailable and never leaks its message", async () => {
    const boom: FileProvider = {
      scheme: "t",
      stat: async () => null,
      list: async () => ({ entries: [] }),
      read: async () => {
        throw new TypeError("secret-token-xyz");
      },
    };
    const err = await readFile([boom], { uri: "t://f/x.md" }, ctx).catch(
      (e) => e,
    );
    expect(String(err.message)).toBe(
      "File providers are unavailable (t); try again.",
    );
  });

  it("uses readLines for an offset request instead of read", async () => {
    const read = vi.fn(async () => null);
    const readLines = vi.fn(async (uri: string) => ({
      uri,
      mime: "text/plain",
      bytes: 100,
      text: "line 11\nline 12\n",
      totalLines: 40,
    }));
    const lp: FileProvider = {
      scheme: "t",
      stat: async () => null,
      list: async () => ({ entries: [] }),
      read,
      readLines,
    };
    const r = await readFile(
      [lp],
      { uri: "t://f/x.md", offset: 11, limit: 2 },
      ctx,
    );
    expect(read).not.toHaveBeenCalled();
    expect(readLines).toHaveBeenCalledWith(
      "t://f/x.md",
      { from: 11, to: 12 },
      ctx,
    );
    expect(r.lines).toEqual({ from: 11, to: 12, total: 40 });
    expect(r.next).toEqual({ uri: "t://f/x.md", offset: 13, limit: 2 });
  });

  it("readLines without totalLines: the byte cap still yields a next, and paging covers every line once", async () => {
    const rows = Array.from(
      { length: 100 },
      (_, i) => `${i}:${"z".repeat(400)}`,
    );
    const readLines = vi.fn(
      async (uri: string, r: { from: number; to: number }) => ({
        uri,
        mime: "text/plain",
        bytes: 1,
        text: `${rows.slice(r.from - 1, r.to).join("\n")}\n`,
      }),
    );
    const lp: FileProvider = {
      scheme: "t",
      stat: async () => null,
      list: async () => ({ entries: [] }),
      read: async () => null,
      readLines,
    };
    const seen: string[] = [];
    let args: { uri: string; offset?: number; limit?: number } = {
      uri: "t://f/x.md",
    };
    for (let guard = 0; guard < 20; guard++) {
      const r = await readFile([lp], args, ctx);
      if (r.text) seen.push(...r.text.split("\n"));
      if (!r.next) break;
      expect(r.next.offset).toBe((r.lines?.to ?? 0) + 1);
      args = r.next;
    }
    expect(seen).toEqual(rows);
  });

  it("readLines past the end returns empty text with the total, no error", async () => {
    const lp: FileProvider = {
      scheme: "t",
      stat: async () => null,
      list: async () => ({ entries: [] }),
      read: async () => null,
      readLines: async (uri) => ({
        uri,
        mime: "text/plain",
        bytes: 1,
        text: "",
        totalLines: 7,
      }),
    };
    const r = await readFile([lp], { uri: "t://f/x.md", offset: 99 }, ctx);
    expect(r.text).toBe("");
    expect(r.lines?.total).toBe(7);
    expect(r.next).toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchFiles } from "./search";
import { staticFiles } from "./static";
import type { FileContext, FileProvider, SearchHit } from "./types";

const ctx = {} as FileContext;
const hit = (n: number): SearchHit => ({
  uri: `t://f${n}`,
  lines: [1, 2],
  snippet: "s",
  score: 1 / (n + 1),
});
const many = (n: number) => Array.from({ length: n }, (_, i) => hit(i));

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

const withSearch = (
  scheme: string,
  search: FileProvider["search"],
): FileProvider => ({ ...staticFiles(scheme, {}), search });

describe("searchFiles", () => {
  it("cuts to 10 by default and 25 at most", async () => {
    const p = withSearch("t", async () => many(40));
    expect((await searchFiles([p], { query: "q" }, ctx)).hits).toHaveLength(10);
    expect(
      (await searchFiles([p], { query: "q", limit: 99 }, ctx)).hits,
    ).toHaveLength(25);
    expect(
      (await searchFiles([p], { query: "q", limit: 0 }, ctx)).hits,
    ).toHaveLength(1);
  });

  it("throws when no provider can search", async () => {
    await expect(
      searchFiles([staticFiles("t", {})], { query: "q" }, ctx),
    ).rejects.toThrow(
      "Search is not available for these files; use grep_files.",
    );
  });

  it("passes uri and limit through", async () => {
    const search = vi.fn(async () => many(1));
    const p = withSearch("t", search);
    await searchFiles([p], { query: "q", uri: "t://d/", limit: 5 }, ctx);
    expect(search).toHaveBeenCalledWith("q", { uri: "t://d/", limit: 5 }, ctx);
  });

  it("concatenates all providers and skips one that throws", async () => {
    const a = withSearch("a", async () => [hit(1)]);
    const bad = withSearch("b", async () => {
      throw new Error("secret-token");
    });
    const c = withSearch("c", async () => [hit(2)]);
    const r = await searchFiles([a, bad, c], { query: "q" }, ctx);
    expect(r.hits.map((h) => h.uri)).toEqual(["t://f1", "t://f2"]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain("secret-token");
  });
});

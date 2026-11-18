import { describe, expect, test, vi } from "vitest";
import type { Executor } from "../types";
import {
  FILES_INSTRUCTIONS,
  fileOperations,
  filesInstructions,
  staticFiles,
} from "./index";
import type { FileProvider } from "./types";

const ctx = { userId: "u1", request: new Request("http://x/") };

const big = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
const tree = () =>
  staticFiles("t", {
    "a/big.md": big,
    "a/small.md": "alpha\nbeta needle\ngamma",
    "a/pic.png": { url: "https://cdn/x.png", mime: "image/png", bytes: 99 },
  });

async function run(
  ops: ReturnType<typeof fileOperations>,
  id: string,
  vars: Record<string, unknown>,
  fallback: Executor = async () => "app",
) {
  return ops.wrap(fallback)(id, vars, ctx);
}

const render = (
  ops: ReturnType<typeof fileOperations>,
  id: string,
  data: unknown,
) => JSON.stringify(ops.operations[id]({ data, variables: {} }));

const message = (
  ops: ReturnType<typeof fileOperations>,
  id: string,
  data: unknown,
) =>
  (
    ops.operations[id]({ data, variables: {} }) as {
      children: { content: string }[];
    }
  ).children[0].content;

const searching = (): FileProvider => ({
  ...tree(),
  scheme: "s",
  async search() {
    return [
      { uri: "s://a/x.md", lines: [3, 9], snippet: "found it", score: 0.9 },
    ];
  },
});

describe("fileOperations", () => {
  test("ids honour prefix and search_files needs a searching provider", () => {
    const plain = fileOperations({ providers: [tree()], prefix: "f_" });
    expect(Object.keys(plain.operations).sort()).toEqual([
      "f_grep_files",
      "f_list_files",
      "f_read_file",
    ]);
    const withSearch = fileOperations({ providers: [searching()] });
    expect(Object.keys(withSearch.operations)).toContain("search_files");
  });

  test("auth reaches every operationConfig and ops are idempotent queries", () => {
    const f = fileOperations({
      providers: [searching()],
      auth: "optional",
    });
    for (const op of Object.values(f.operations)) {
      expect(op.operationConfig.auth).toBe("optional");
      expect(op.operationConfig.type).toBe("query");
      expect(op.operationConfig.idempotent).toBe(true);
    }
  });

  test("input schemas declare integer, string and boolean fields", () => {
    const f = fileOperations({ providers: [searching()] });
    const props = (id: string) =>
      (
        f.operations[id].operationConfig.input as {
          properties: Record<string, { type: string }>;
        }
      ).properties;
    expect(props("read_file").head.type).toBe("integer");
    expect(props("read_file").offset.type).toBe("integer");
    expect(props("read_file").uri.type).toBe("string");
    expect(props("list_files").depth.type).toBe("integer");
    expect(props("grep_files").ignoreCase.type).toBe("boolean");
    expect(props("grep_files").context.type).toBe("integer");
    expect(props("search_files").query.type).toBe("string");
  });

  test("instructions are suffix-ready: a blank line, then FILES_INSTRUCTIONS", () => {
    const f = fileOperations({ providers: [tree()] });
    expect(f.instructions).toBe(`\n\n${FILES_INSTRUCTIONS}`);
    expect(f.instructions.startsWith("\n\n")).toBe(true);
    expect(f.instructions).toContain("relative");
    expect(f.instructions).toContain("list_files");
  });

  test("filesInstructions names the prefixed tools; FILES_INSTRUCTIONS is bare", () => {
    expect(filesInstructions()).toBe(FILES_INSTRUCTIONS);
    expect(filesInstructions("")).toBe(FILES_INSTRUCTIONS);
    expect(FILES_INSTRUCTIONS.startsWith("\n")).toBe(false);
    const kb = filesInstructions("kb_");
    expect(kb).toContain("kb_list_files");
    expect(kb).toContain("kb_read_file");
    expect(kb).not.toMatch(/(?<![\w])(list_files|read_file)\b/);
    const f = fileOperations({ providers: [tree()], prefix: "kb_" });
    expect(f.instructions).toBe(`\n\n${kb}`);
  });

  test("engine errors name the prefixed tools", async () => {
    const f = fileOperations({ providers: [tree()], prefix: "kb_" });
    const message = (id: string, vars: Record<string, unknown>) =>
      run(f, id, vars).then(
        () => "",
        (e: Error) => e.message,
      );
    const errors = [
      await message("kb_read_file", { uri: "t://a/nope.md" }),
      await message("kb_read_file", { path: "x.md" }),
      await message("kb_list_files", { uri: "t://nope/" }),
      await message("kb_grep_files", { uri: "t://nope/", pattern: "x" }),
    ];
    expect(errors[0]).toBe(
      "No file at t://a/nope.md; call kb_list_files to browse.",
    );
    expect(errors[1]).toContain("kb_use_skill");
    expect(errors[2]).toContain("call kb_list_files");
    expect(errors[3]).toContain("call kb_list_files");
    for (const e of errors) {
      expect(e).not.toMatch(/(?<![\w])(list_files|read_file|use_skill)\b/);
    }
    const bare = fileOperations({ providers: [tree()] });
    await expect(
      run(bare, "read_file", { uri: "t://a/nope.md" }),
    ).rejects.toThrow("No file at t://a/nope.md; call list_files to browse.");
  });

  test("tool instructions carry the paging guidance", () => {
    const f = fileOperations({ providers: [searching()] });
    const read = f.operations.read_file.operationConfig.instruction ?? "";
    expect(read).toContain("200");
    expect(read).toContain("next");
    expect(read).toContain("base");
    expect(read).toContain("grep_files");
  });

  test("search_files is named only when it is registered", () => {
    const text = (f: ReturnType<typeof fileOperations>, id: string) =>
      f.operations[id].operationConfig.instruction ?? "";
    const plain = fileOperations({ providers: [tree()] });
    for (const id of ["list_files", "read_file"]) {
      expect(text(plain, id)).toContain("grep_files");
      expect(text(plain, id)).not.toContain("search_files");
    }
    const withSearch = fileOperations({ providers: [searching()] });
    for (const id of ["list_files", "read_file"]) {
      expect(text(withSearch, id)).toContain("grep_files");
      expect(text(withSearch, id)).toContain("search_files");
    }
  });

  test("read_file renders numbered lines and a footer with next", async () => {
    const f = fileOperations({ providers: [tree()] });
    const data = await run(f, "read_file", { uri: "t://a/big.md" });
    const text = render(f, "read_file", data);
    expect(text).toContain("1\\tline 1");
    expect(text).not.toContain("201\\t");
    expect(text).toContain("offset");
    expect(text).toContain("201");
    expect(text).toContain("t://a/big.md");
  });

  test("read_file footer includes limit when present", async () => {
    const f = fileOperations({ providers: [tree()] });
    const data = await run(f, "read_file", { uri: "t://a/big.md", limit: 10 });
    expect(render(f, "read_file", data)).toContain("limit");
  });

  test("read_file on binary prints mime, bytes and url without content", async () => {
    const f = fileOperations({ providers: [tree()] });
    const data = await run(f, "read_file", { uri: "t://a/pic.png" });
    const text = render(f, "read_file", data);
    expect(text).toContain("image/png");
    expect(text).toContain("99");
    expect(text).toContain("https://cdn/x.png");
  });

  test("read_file past the end prints a note with the total", async () => {
    const f = fileOperations({ providers: [tree()] });
    const data = await run(f, "read_file", {
      uri: "t://a/small.md",
      offset: 50,
    });
    const text = render(f, "read_file", data);
    expect(text).toContain("3");
    expect(text.toLowerCase()).toContain("past the end");
  });

  test("a blank slice is not reported as past the end", async () => {
    const f = fileOperations({
      providers: [staticFiles("b", { "x.md": "a\n\nc" })],
    });
    const data = await run(f, "read_file", {
      uri: "b://x.md",
      offset: 2,
      limit: 1,
    });
    const text = render(f, "read_file", data);
    expect(text).toContain("2\\t");
    expect(text).not.toContain("past the end");
  });

  test("a tail cut by the size cap says how to read the earlier lines", async () => {
    const wide = Array.from(
      { length: 300 },
      (_, i) => `${i + 1} ${"x".repeat(1500)}`,
    );
    const f = fileOperations({
      providers: [staticFiles("w", { "wide.md": wide.join("\n") })],
    });
    const data = (await run(f, "read_file", {
      uri: "w://wide.md",
      tail: 200,
    })) as { lines: { from: number } };
    const from = data.lines.from;
    expect(from).toBeGreaterThan(1);
    const m = /offset: (\d+), limit: (\d+)/.exec(message(f, "read_file", data));
    expect(m).not.toBeNull();
    const [offset, limit] = [Number(m?.[1]), Number(m?.[2])];
    const earlier = (await run(f, "read_file", {
      uri: "w://wide.md",
      offset,
      limit,
    })) as {
      text: string;
      lines: { from: number; to: number };
      next?: { offset: number };
    };
    expect(earlier.lines.from).toBe(offset);
    // The byte cap may stop the window short; its next then continues to from - 1.
    expect(earlier.lines.to < from - 1 ? earlier.next : true).toBeTruthy();
    expect(offset).toBeLessThan(from);
  });

  test("a complete read with only a long line cut notes it without an offset", async () => {
    const f = fileOperations({
      providers: [
        staticFiles("l", { "long.md": `short\n${"y".repeat(50000)}\nend` }),
      ],
    });
    const data = await run(f, "read_file", { uri: "l://long.md" });
    const msg = message(f, "read_file", data);
    expect(msg).toContain("long lines were cut");
    expect(msg).not.toContain("offset");
  });

  test("a relative path without base rejects", async () => {
    const f = fileOperations({ providers: [tree()] });
    await expect(run(f, "read_file", { path: "x.md" })).rejects.toThrow(
      /needs base/,
    );
  });

  test("a relative path with base resolves", async () => {
    const f = fileOperations({ providers: [tree()] });
    const data = await run(f, "read_file", {
      path: "small.md",
      base: "t://a/big.md",
    });
    expect(render(f, "read_file", data)).toContain("beta needle");
  });

  test("non-integer and non-finite numbers are rejected", async () => {
    const f = fileOperations({ providers: [tree()] });
    await expect(
      run(f, "read_file", { uri: "t://a/big.md", head: 1.5 }),
    ).rejects.toThrow(/head must be an integer/);
    await expect(
      run(f, "read_file", { uri: "t://a/big.md", offset: Number.NaN }),
    ).rejects.toThrow(/offset must be an integer/);
    await expect(
      run(f, "list_files", { uri: "t://a", depth: Number.POSITIVE_INFINITY }),
    ).rejects.toThrow(/depth must be an integer/);
    await expect(
      run(f, "grep_files", { uri: "t://a", pattern: "x", context: "2" }),
    ).rejects.toThrow(/context must be an integer/);
  });

  test("list_files with no uri lists roots, and lists entries", async () => {
    const f = fileOperations({ providers: [tree()] });
    const roots = await run(f, "list_files", {});
    expect(render(f, "list_files", roots)).toContain("t://");
    const data = await run(f, "list_files", { uri: "t://a" });
    const text = render(f, "list_files", data);
    expect(text).toContain("t://a/small.md");
    expect(text).toContain("3 lines");
  });

  test("grep_files prints matches with context and the capped note", async () => {
    const f = fileOperations({ providers: [tree()] });
    const data = await run(f, "grep_files", {
      uri: "t://a",
      pattern: "needle",
      context: 1,
    });
    const text = render(f, "grep_files", data);
    expect(text).toContain("t://a/small.md:2: beta needle");
    const capped = render(f, "grep_files", { hits: [], capped: true });
    expect(capped.toLowerCase()).toContain("capped");
  });

  test("search_files prints hits with a read_file hint", async () => {
    const f = fileOperations({ providers: [searching()] });
    const data = await run(f, "search_files", { query: "q" });
    const text = render(f, "search_files", data);
    expect(text).toContain("s://a/x.md");
    expect(text).toContain("3-9");
    expect(text).toContain("found it");
    expect(text).toContain("read_file");
  });

  test("an unknown operation id goes to the fallback", async () => {
    const f = fileOperations({ providers: [tree()] });
    const fb = vi.fn(async () => "app");
    expect(await run(f, "nope", {}, fb)).toBe("app");
    expect(await run(f, "constructor", {}, fb)).toBe("app");
    expect(fb).toHaveBeenCalledTimes(2);
  });

  test("search_files falls through when not registered", async () => {
    const f = fileOperations({ providers: [tree()] });
    expect(await run(f, "search_files", {})).toBe("app");
  });
});

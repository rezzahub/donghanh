import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

describe("parseFrontmatter", () => {
  it("reads name and description and strips quotes", () => {
    const r = parseFrontmatter(
      '---\nname: x\ndescription: "Does y"\n---\nbody\n',
    );
    expect(r?.fields).toEqual({ name: "x", description: "Does y" });
    expect(r?.body).toBe("body\n");
    expect(r?.folded).toEqual([]);
  });
  it("reads the metadata block", () => {
    const r = parseFrontmatter(
      '---\nname: x\nmetadata:\n  version: "1.0.0"\n  include: a.md, b.md\n---\n',
    );
    expect(r?.metadata).toEqual({ version: "1.0.0", include: "a.md, b.md" });
    expect(r?.folded).toEqual([]);
  });
  it("flags folded and continued scalars", () => {
    const r = parseFrontmatter(
      "---\nname: x\ndescription: >-\n  long\n  text\ntitle: a\n  b\n---\n",
    );
    expect(r?.folded).toEqual(["description", "title"]);
  });
  it("parses CRLF", () => {
    const r = parseFrontmatter("---\r\nname: x\r\n---\r\nbody");
    expect(r?.fields.name).toBe("x");
    expect(r?.body).toBe("body");
  });
  it("returns null without frontmatter", () => {
    expect(parseFrontmatter("# hi\n")).toBeNull();
  });
});

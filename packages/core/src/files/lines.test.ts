import { describe, expect, it } from "vitest";
import { splitLines } from "./lines";

describe("splitLines", () => {
  it("has no lines for empty text", () => {
    expect(splitLines("")).toEqual([]);
  });
  it("drops one trailing empty element", () => {
    expect(splitLines("a\n")).toEqual(["a"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });
  it("counts a last line without newline", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });
  it("strips trailing carriage returns", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

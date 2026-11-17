import { describe, expect, test } from "vitest";
import { absolutizeRefs, extractRefs, resolveRef, uriScheme } from "./refs";

const SKILL = "mintube://niche/n10/skills/x/SKILL.md";

describe("resolveRef", () => {
  test("resolves against the directory of base", () => {
    expect(resolveRef(SKILL, "references/y.md")).toBe(
      "mintube://niche/n10/skills/x/references/y.md",
    );
    expect(resolveRef(SKILL, "../../competitors/a.md")).toBe(
      "mintube://niche/n10/competitors/a.md",
    );
    expect(resolveRef("mintube://niche/n10/skills/x/", "y.md")).toBe(
      "mintube://niche/n10/skills/x/y.md",
    );
  });

  test("leaves absolute refs alone and drops a base @version", () => {
    expect(resolveRef(SKILL, "mintube://team/t1/b.md")).toBe(
      "mintube://team/t1/b.md",
    );
    expect(
      resolveRef(
        "mintube://canonical/skills/x/SKILL.md@1.2.0",
        "references/y.md",
      ),
    ).toBe("mintube://canonical/skills/x/references/y.md");
  });

  test("clamps ../ at the root instead of throwing", () => {
    expect(resolveRef("mintube://niche/n10/a.md", "../../../../x.md")).toMatch(
      /^mintube:\/\/niche\//,
    );
  });

  test("returns the uri as providers list it: no fragment, path decoded", () => {
    expect(resolveRef(SKILL, "references/y.md#approval")).toBe(
      "mintube://niche/n10/skills/x/references/y.md",
    );
    expect(resolveRef(SKILL, "my%20notes.md")).toBe(
      "mintube://niche/n10/skills/x/my notes.md",
    );
    expect(resolveRef(SKILL, "tài-liệu.md")).toBe(
      "mintube://niche/n10/skills/x/tài-liệu.md",
    );
    expect(resolveRef("mintube://niche/tài/SKILL.md", "a b.md#x")).toBe(
      "mintube://niche/tài/a b.md",
    );
  });

  test("keeps an undecodable path encoded", () => {
    expect(resolveRef(SKILL, "bad%E0%A4.md")).toBe(
      "mintube://niche/n10/skills/x/bad%E0%A4.md",
    );
  });

  test("throws on an unparseable base", () => {
    expect(() => resolveRef("not a uri", "a.md")).toThrow(/Invalid base uri/);
  });
});

const MD = [
  "See [a](references/x.md) and ![i](img/p.png).",
  "Web [w](https://e.com), top [h](#top), team [m](mintube://team/t/b.md).",
  "Again [dup](references/x.md).",
].join("\n");

describe("extractRefs", () => {
  test("returns relative and scheme refs, skipping http, mailto and anchors", () => {
    expect(extractRefs(MD, SKILL)).toEqual([
      {
        raw: "references/x.md",
        uri: "mintube://niche/n10/skills/x/references/x.md",
      },
      { raw: "img/p.png", uri: "mintube://niche/n10/skills/x/img/p.png" },
      { raw: "mintube://team/t/b.md", uri: "mintube://team/t/b.md" },
    ]);
  });

  test("keeps the raw text and returns the decoded uri without fragment", () => {
    expect(
      extractRefs("[d](references/d.md#approval) [v](tài-liệu.md)", SKILL),
    ).toEqual([
      {
        raw: "references/d.md#approval",
        uri: "mintube://niche/n10/skills/x/references/d.md",
      },
      { raw: "tài-liệu.md", uri: "mintube://niche/n10/skills/x/tài-liệu.md" },
    ]);
  });

  test("skips mailto links", () => {
    expect(extractRefs("[m](mailto:a@b.c)", SKILL)).toEqual([]);
  });

  test("ignores fenced code and inline code and never throws on malformed links", () => {
    const md = "```\n[x](a.md)\n```\n\n`[y](b.md)`\n\n[broken](\n\n[a](b.md";
    expect(extractRefs(md, SKILL)).toEqual([]);
  });
});

describe("absolutizeRefs", () => {
  test("rewrites only those targets and leaves all other text byte-identical", () => {
    const md = [
      "Intro  [a](references/x.md) trailing  ",
      "![i](img/p.png)",
      "[w](https://e.com) [h](#top)",
      "```",
      "[c](code.md)",
      "```",
      "`[d](inline.md)` end",
    ].join("\n");
    const out = absolutizeRefs(md, SKILL);
    expect(out).toBe(
      [
        "Intro  [a](mintube://niche/n10/skills/x/references/x.md) trailing  ",
        "![i](mintube://niche/n10/skills/x/img/p.png)",
        "[w](https://e.com) [h](#top)",
        "```",
        "[c](code.md)",
        "```",
        "`[d](inline.md)` end",
      ].join("\n"),
    );
  });

  test("keeps the encoded form with the fragment", () => {
    expect(
      absolutizeRefs(
        "[d](d.md#approval) [v](tài liệu.md) [s](a%20b.md)",
        SKILL,
      ),
    ).toBe(
      "[d](mintube://niche/n10/skills/x/d.md#approval) " +
        "[v](tài liệu.md) " +
        "[s](mintube://niche/n10/skills/x/a%20b.md)",
    );
    expect(absolutizeRefs("[v](tài-liệu.md)", SKILL)).toBe(
      "[v](mintube://niche/n10/skills/x/t%C3%A0i-li%E1%BB%87u.md)",
    );
  });

  test("returns markdown without links unchanged", () => {
    expect(absolutizeRefs("plain\n\ntext", SKILL)).toBe("plain\n\ntext");
  });
});

test("uriScheme", () => {
  expect(uriScheme("mintube://a/b")).toBe("mintube");
  expect(uriScheme("references/x.md")).toBeNull();
});

import { describe, expect, test, vi } from "vitest";
import { type FileProvider, listFiles, staticFiles } from "./files";
import { App } from "./primitives";
import { buildRegistry } from "./registry";
import { renderSkillBrief } from "./skill-files";
import {
  parseSkillMarkdown,
  type Skill,
  type SkillProvider,
  type SkillSummary,
  skillHash,
  skillOperations,
  staticSkills,
} from "./skills";
import type { Executor, OperationComponent } from "./types";

const ctx = { userId: "u1", request: new Request("http://x/") };

function md(name: string, description = `${name} desc`, body = "Body.") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;
}

async function run(
  skills: ReturnType<typeof skillOperations>,
  id: string,
  vars: Record<string, unknown>,
  fallback: Executor = async () => "app",
) {
  return skills.wrap(fallback)(id, vars, ctx);
}

/** In-memory read-write provider. */
function memoryProvider(
  key: string,
): SkillProvider & { store: Map<string, Skill> } {
  const store = new Map<string, Skill>();
  let n = 0;
  const toSkill = async (id: string, markdown: string): Promise<Skill> => {
    const p = parseSkillMarkdown(markdown);
    return {
      id,
      slug: p.name,
      name: p.name,
      description: p.description,
      hash: await skillHash(markdown),
      writableBy: key,
      markdown,
    };
  };
  return {
    key,
    store,
    async search(q) {
      return [...store.values()].filter((s) => s.name.includes(q) || q === "");
    },
    async get(slug) {
      return [...store.values()].find((s) => s.slug === slug) ?? null;
    },
    async create(input) {
      const s = await toSkill(`m${++n}`, input.markdown);
      store.set(s.id, s);
      return s;
    },
    async update(id, input) {
      const s = await toSkill(id, input.markdown);
      store.set(id, s);
      return s;
    },
    async delete(id) {
      store.delete(id);
    },
  };
}

const readOnly = (key: string, names: string[]) =>
  staticSkills(
    key,
    Object.fromEntries(names.map((n) => [`${n}/SKILL.md`, md(n)])),
  );

describe("parseSkillMarkdown", () => {
  test("parseSkillMarkdown requires name and description frontmatter", () => {
    expect(parseSkillMarkdown(md("a-b", "Does it", "Hello"))).toEqual({
      name: "a-b",
      description: "Does it",
      metadata: {},
      body: "Hello\n",
    });
    expect(
      parseSkillMarkdown(
        '---\nname: a\ndescription: d\nmetadata:\n  owner: ann\n  tier: "2"\n---\nB',
      ).metadata,
    ).toEqual({ owner: "ann", tier: "2" });
    expect(() => parseSkillMarkdown("no frontmatter")).toThrow(/frontmatter/);
    expect(() => parseSkillMarkdown("---\nname: x\n---\nb")).toThrow(
      /description/,
    );
    expect(() => parseSkillMarkdown("---\ndescription: x\n---\nb")).toThrow(
      /name/,
    );
  });

  test("staticSkills rejects a bad slug", () => {
    expect(() => staticSkills("k", { "bad/SKILL.md": md("Bad Name") })).toThrow(
      /slug/,
    );
  });

  test("staticSkills rejects a directory that differs from the name", () => {
    expect(() => staticSkills("k", { "other/SKILL.md": md("x") })).toThrow(
      /directory/,
    );
  });

  test("staticSkills accepts an empty tree", async () => {
    const s = staticSkills("k", {});
    expect(await s.search("", ctx)).toEqual([]);
  });

  test("staticSkills throws on a non-empty tree with no skill", () => {
    expect(() => staticSkills("k", { "x/notes.md": "n", "y.md": "y" })).toThrow(
      'staticSkills expects a tree of "<slug>/SKILL.md" files; none of the 2 entries is one (the old form took { name: markdown }, see the 0.5.0 changelog)',
    );
    expect(() => staticSkills("k", { "a/b/SKILL.md": md("b") })).toThrow(
      /none of the 1 entries/,
    );
  });

  test("staticSkills throws on the old flat form", () => {
    expect(() => staticSkills("k", { foo: md("foo"), bar: md("bar") })).toThrow(
      /none of the 2 entries/,
    );
  });

  test("staticSkills throws on a root SKILL.md", () => {
    expect(() =>
      staticSkills("k", { "SKILL.md": md("x"), "x/SKILL.md": md("x") }),
    ).toThrow(
      'staticSkills: "SKILL.md" at the root of the tree is not a skill; put it at "<slug>/SKILL.md"',
    );
    expect(() => staticSkills("k", { "SKILL.md": md("x") })).toThrow(
      /root of the tree/,
    );
  });

  test("staticSkills treats other tree entries as files, not skills", async () => {
    const s = staticSkills("k", {
      "x/SKILL.md": md("x"),
      "x/notes.md": "# Notes\n",
      "a/b/SKILL.md": md("zzz"),
    });
    expect((await s.search("", ctx)).map((k) => k.slug)).toEqual(["x"]);
    expect(await s.get("zzz", ctx)).toBeNull();
    const l = await listFiles([s.files], { uri: "skills://k/x/" }, ctx);
    expect(l.entries.map((e) => e.uri).sort()).toEqual([
      "skills://k/x/SKILL.md",
      "skills://k/x/notes.md",
    ]);
    const nested = await listFiles([s.files], { uri: "skills://k/a/b/" }, ctx);
    expect(nested.entries.map((e) => e.uri)).toEqual([
      "skills://k/a/b/SKILL.md",
    ]);
  });

  test("a skill has a uri; search summaries omit it and the markdown", async () => {
    const s = staticSkills("k", { "x/SKILL.md": md("x") });
    expect((await s.get("x", ctx))?.uri).toBe("skills://k/x/SKILL.md");
    const [sum] = await s.search("", ctx);
    expect(sum).not.toHaveProperty("uri");
    expect(sum).not.toHaveProperty("markdown");
  });
});

describe("skillOperations", () => {
  test("read-only providers generate only search_skills and use_skill", () => {
    const { operations } = skillOperations({
      providers: [readOnly("a", ["x"])],
    });
    expect(Object.keys(operations).sort()).toEqual([
      "search_skills",
      "use_skill",
    ]);
    expect(operations.search_skills.operationConfig.type).toBe("query");
    expect(operations.use_skill.operationConfig.idempotent).toBe(true);
  });

  test("a writable provider adds manage_skill (not destructive) and delete_skill (destructive)", () => {
    const { operations } = skillOperations({
      providers: [memoryProvider("m")],
    });
    expect(Object.keys(operations).sort()).toEqual([
      "delete_skill",
      "manage_skill",
      "search_skills",
      "use_skill",
    ]);
    expect(operations.manage_skill.operationConfig.type).toBe("mutation");
    expect(operations.manage_skill.operationConfig.destructive).toBeFalsy();
    expect(operations.delete_skill.operationConfig.destructive).toBe(true);
  });

  test("auth option is passed to every operation", () => {
    const { operations } = skillOperations({
      providers: [memoryProvider("m")],
      auth: "optional",
    });
    for (const op of Object.values(operations)) {
      expect(op.operationConfig.auth).toBe("optional");
    }
  });

  test("search merges providers in order; first wins on slug; ids are key:id", async () => {
    const s = skillOperations({
      providers: [
        readOnly("a", ["one", "two"]),
        readOnly("b", ["two", "three"]),
      ],
    });
    const r = (await run(s, "search_skills", { query: "" })) as {
      skills: SkillSummary[];
      writableTargets: string[];
    };
    expect(r.skills.map((x) => x.id)).toEqual(["a:one", "a:two", "b:three"]);
    expect(r.writableTargets).toEqual([]);
  });

  test("search limit defaults to 5 and caps at 10", async () => {
    const names = Array.from({ length: 15 }, (_, i) => `s-${i}`);
    const s = skillOperations({ providers: [readOnly("a", names)] });
    const count = async (v: Record<string, unknown>) =>
      (
        (await run(s, "search_skills", { query: "", ...v })) as {
          skills: unknown[];
        }
      ).skills.length;
    expect(await count({})).toBe(5);
    expect(await count({ limit: 50 })).toBe(10);
    expect(await count({ limit: 2 })).toBe(2);
  });

  test("use_skill returns the markdown and its hash", async () => {
    const markdown = md("deploy", "Deploys", "Steps.");
    const s = skillOperations({
      providers: [staticSkills("a", { "deploy/SKILL.md": markdown })],
    });
    const r = (await run(s, "use_skill", { slug: "deploy" })) as Skill;
    expect(r.id).toBe("a:deploy");
    expect(r.markdown).toBe(markdown);
    expect(r.hash).toBe(await skillHash(markdown));
    expect(r.hash).toMatch(/^[0-9a-f]{12}$/);
    await expect(run(s, "use_skill", { slug: "nope" })).rejects.toThrow(/nope/);
  });

  test("create goes to target when given, else the first writable provider", async () => {
    const m1 = memoryProvider("m1");
    const m2 = memoryProvider("m2");
    const s = skillOperations({ providers: [readOnly("a", ["x"]), m1, m2] });
    const first = (await run(s, "manage_skill", {
      create: { title: "T", markdown: md("one") },
    })) as Skill;
    expect(first.id).toBe("m1:m1");
    const second = (await run(s, "manage_skill", {
      create: { title: "T", markdown: md("two"), target: "m2" },
    })) as Skill;
    expect(second.id).toBe("m2:m1");
    expect(m1.store.size).toBe(1);
    expect(m2.store.size).toBe(1);
    await expect(
      run(s, "manage_skill", {
        create: { title: "T", markdown: md("z"), target: "a" },
      }),
    ).rejects.toThrow(/target/);
    const search = (await run(s, "search_skills", { query: "" })) as {
      writableTargets: string[];
    };
    expect(search.writableTargets).toEqual(["m1", "m2"]);
  });

  test("manage_skill needs exactly one of create and update", async () => {
    const s = skillOperations({ providers: [memoryProvider("m")] });
    await expect(run(s, "manage_skill", {})).rejects.toThrow(/exactly one/);
    await expect(
      run(s, "manage_skill", {
        create: { title: "T", markdown: md("a") },
        update: { id: "m:1", title: "T", markdown: md("a") },
      }),
    ).rejects.toThrow(/exactly one/);
  });

  test("update and delete route by id prefix; an unknown prefix is an error", async () => {
    const m = memoryProvider("m");
    const s = skillOperations({ providers: [readOnly("a", ["x"]), m] });
    const c = (await run(s, "manage_skill", {
      create: { title: "T", markdown: md("one") },
    })) as Skill;
    const u = (await run(s, "manage_skill", {
      update: { id: c.id, title: "T", markdown: md("one", "changed") },
    })) as Skill;
    expect(u.description).toBe("changed");
    expect(m.store.get("m1")?.description).toBe("changed");
    await run(s, "delete_skill", { id: c.id });
    expect(m.store.size).toBe(0);
    await expect(run(s, "delete_skill", { id: "zzz:1" })).rejects.toThrow(
      /zzz/,
    );
    await expect(run(s, "delete_skill", { id: "noprefix" })).rejects.toThrow(
      /id/,
    );
    await expect(run(s, "delete_skill", { id: "a:x" })).rejects.toThrow(
      'Provider "a" is read-only',
    );
    await expect(
      run(s, "manage_skill", {
        update: { id: "a:x", title: "T", markdown: md("x") },
      }),
    ).rejects.toThrow('Provider "a" is read-only');
  });

  test("a skill created mid-session is found by the next search", async () => {
    const s = skillOperations({ providers: [memoryProvider("m")] });
    const before = (await run(s, "search_skills", { query: "fresh" })) as {
      skills: unknown[];
    };
    expect(before.skills).toHaveLength(0);
    await run(s, "manage_skill", {
      create: { title: "T", markdown: md("fresh") },
    });
    const after = (await run(s, "search_skills", { query: "fresh" })) as {
      skills: SkillSummary[];
    };
    expect(after.skills.map((x) => x.name)).toEqual(["fresh"]);
    expect(after.skills[0].writableBy).toBe("m");
  });

  test("one provider throwing in search doesn't hide the others", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad: SkillProvider = {
        key: "bad",
        async search() {
          throw new Error("secret detail");
        },
        async get() {
          throw new Error("secret detail");
        },
      };
      const good = readOnly("a", ["x"]);
      const always: SkillProvider = {
        ...good,
        search: (_q, c) => good.search("", c),
      };
      const s = skillOperations({ providers: [bad, always] });
      const r = (await run(s, "search_skills", { query: "SECRETQUERY" })) as {
        skills: SkillSummary[];
      };
      expect(r.skills.map((x) => x.id)).toEqual(["a:x"]);
      const u = (await run(s, "use_skill", { slug: "x" })) as Skill;
      expect(u.id).toBe("a:x");
      expect(spy).toHaveBeenCalledWith(
        "[skills] provider bad search failed (Error)",
      );
      expect(spy).toHaveBeenCalledWith(
        "[skills] provider bad get failed (Error)",
      );
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("SECRETQUERY");
      expect(logged).not.toContain("secret detail");
    } finally {
      spy.mockRestore();
    }
  });

  test("markdown over 65536 characters is rejected on create", async () => {
    const s = skillOperations({ providers: [memoryProvider("m")] });
    const big = md("big", "d", "x".repeat(65536));
    await expect(
      run(s, "manage_skill", { create: { title: "T", markdown: big } }),
    ).rejects.toThrow(/65536/);
    await expect(
      run(s, "manage_skill", {
        update: { id: "m:1", title: "T", markdown: big },
      }),
    ).rejects.toThrow(/65536/);
  });

  test("wrap routes skill ids to providers and others to the app executor", async () => {
    const s = skillOperations({ providers: [readOnly("a", ["x"])] });
    const seen: string[] = [];
    const app: Executor = async (id) => {
      seen.push(id);
      return "app-result";
    };
    expect(await run(s, "start", {}, app)).toBe("app-result");
    expect(seen).toEqual(["start"]);
    await run(s, "search_skills", { query: "" }, app);
    expect(seen).toEqual(["start"]);
  });

  test("prefix namespaces the generated operation ids", async () => {
    const s = skillOperations({
      providers: [memoryProvider("m")],
      prefix: "idea_",
    });
    expect(Object.keys(s.operations).sort()).toEqual([
      "idea_delete_skill",
      "idea_manage_skill",
      "idea_search_skills",
      "idea_use_skill",
    ]);
    expect(s.operations.idea_search_skills.operationConfig.id).toBe(
      "idea_search_skills",
    );
    const r = (await run(s, "idea_search_skills", { query: "" })) as {
      skills: unknown[];
    };
    expect(r.skills).toEqual([]);
    // unprefixed id is not a skill operation
    expect(await run(s, "search_skills", {}, async () => "app")).toBe("app");
  });

  test("spreading skill operations over an app operation of the same id throws", () => {
    const skills = skillOperations({ providers: [readOnly("a", ["x"])] });
    const mine = (() => null) as unknown as OperationComponent;
    mine.operationConfig = {
      ...skills.operations.search_skills.operationConfig,
    };
    expect(() =>
      buildRegistry(App({ operations: { mine, ...skills.operations } })),
    ).toThrow(/Duplicate operation id "search_skills"/);
  });

  test("operations render the summary lines and the markdown", async () => {
    const s = skillOperations({ providers: [readOnly("a", ["x"])] });
    const search = s.operations.search_skills;
    const data = await run(s, "search_skills", { query: "" });
    const node = search({ data, variables: {} });
    expect(JSON.stringify(node)).toContain("a:x");
    const use = s.operations.use_skill;
    const skill = await run(s, "use_skill", { slug: "x" });
    expect(JSON.stringify(use({ data: skill, variables: {} }))).toContain(
      "Body.",
    );
  });

  test("duplicate or invalid provider keys are a startup error", () => {
    expect(() =>
      skillOperations({ providers: [readOnly("a", []), readOnly("a", [])] }),
    ).toThrow(/unique/);
    expect(() => skillOperations({ providers: [readOnly("a:b", [])] })).toThrow(
      /key/,
    );
  });

  test("instructions and errors name the prefixed tools", async () => {
    const s = skillOperations({
      providers: [memoryProvider("m")],
      prefix: "idea_",
    });
    const config = (id: string) => s.operations[id].operationConfig;
    const text = JSON.stringify([
      config("idea_search_skills"),
      config("idea_use_skill"),
      config("idea_manage_skill"),
      config("idea_delete_skill"),
    ]);
    expect(text).not.toMatch(/(?<![a-z_])(search_skills|use_skill)/);
    expect(config("idea_search_skills").instruction).toContain(
      "idea_use_skill",
    );
    await expect(run(s, "idea_use_skill", { slug: "nope" })).rejects.toThrow(
      /idea_search_skills/,
    );
    await expect(
      run(s, "idea_delete_skill", { id: "noprefix" }),
    ).rejects.toThrow(/idea_search_skills/);
  });

  test("a prefix-less app operation named like an Object.prototype key falls through", async () => {
    const s = skillOperations({ providers: [memoryProvider("m")] });
    expect(await run(s, "constructor", {}, async () => "app")).toBe("app");
    expect(await run(s, "toString", {}, async () => "app")).toBe("app");
  });

  test("folded and literal YAML descriptions throw an actionable error", () => {
    for (const marker of [">-", ">", "|", "|-"]) {
      expect(() =>
        parseSkillMarkdown(
          `---\nname: a\ndescription: ${marker}\n  Long text.\n---\nBody\n`,
        ),
      ).toThrow(/single line/);
    }
    expect(parseSkillMarkdown(md("a")).description).toBe("a desc");
  });
});

describe("frontmatter keys", () => {
  test("indented lines under other keys are not top-level keys", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: real\nmetadata:\n  name: other\n  description: nope\ndescription: Real desc\n---\nB",
    );
    expect(parsed.name).toBe("real");
    expect(parsed.description).toBe("Real desc");
  });

  test("a multi-line plain description throws the single line error", () => {
    expect(() =>
      parseSkillMarkdown(
        "---\nname: a\ndescription: First line\n  second line\n---\nB",
      ),
    ).toThrow(/single line/);
    expect(() =>
      parseSkillMarkdown("---\nname: a\n  more\ndescription: d\n---\nB"),
    ).toThrow(/single line/);
  });
});

describe("staticSkills search", () => {
  test("splits on whitespace and matches any token, case-insensitively, in slug too", async () => {
    const p = staticSkills("a", {
      "pr-review/SKILL.md": md("pr-review", "Checks a pull request"),
      "deploy/SKILL.md": md("deploy", "Ships it"),
      "other/SKILL.md": md("other", "Unrelated"),
    });
    const names = async (q: string) =>
      (await p.search(q, ctx)).map((s) => s.name).sort();
    expect(await names("review pull request")).toEqual(["pr-review"]);
    expect(await names("SHIPS   Request")).toEqual(["deploy", "pr-review"]);
    expect(await names("   ")).toEqual(["deploy", "other", "pr-review"]);
    expect(await names("zzz")).toEqual([]);
  });
});

describe("provider selection", () => {
  const two = () =>
    skillOperations({
      providers: [
        staticSkills("a", {
          "deploy/SKILL.md": md("deploy", "From A", "A body"),
        }),
        staticSkills("b", {
          "deploy/SKILL.md": md("deploy", "From B", "B body"),
        }),
      ],
    });

  test("search shows the provider; use_skill honours provider", async () => {
    const s = two();
    const r = (await run(s, "search_skills", { query: "deploy" })) as {
      skills: (SkillSummary & { provider?: string })[];
    };
    expect(r.skills[0].id).toBe("a:deploy");
    expect(r.skills[0].provider).toBe("a");
    const node = JSON.stringify(
      s.operations.search_skills({ data: r, variables: {} }),
    );
    expect(node).toContain("provider a");
    expect(((await run(s, "use_skill", { slug: "deploy" })) as Skill).id).toBe(
      "a:deploy",
    );
    const b = (await run(s, "use_skill", {
      slug: "deploy",
      provider: "b",
    })) as Skill;
    expect(b.id).toBe("b:deploy");
    expect(b.markdown).toContain("B body");
    expect(s.operations.use_skill.operationConfig.instruction).toMatch(
      /provider/,
    );
  });

  test("an unknown provider names the valid keys", async () => {
    await expect(
      run(two(), "use_skill", { slug: "deploy", provider: "zz" }),
    ).rejects.toThrow(/a, b/);
  });
});

describe("canCreate", () => {
  test("filters writableTargets and guards create", async () => {
    const m1 = { ...memoryProvider("m1"), canCreate: () => false };
    const m2 = memoryProvider("m2");
    const m3 = { ...memoryProvider("m3"), canCreate: async () => true };
    const s = skillOperations({ providers: [m1, m2, m3] });
    const search = (await run(s, "search_skills", { query: "" })) as {
      writableTargets: string[];
    };
    expect(search.writableTargets).toEqual(["m2", "m3"]);
    await expect(
      run(s, "manage_skill", {
        create: { title: "T", markdown: md("a"), target: "m1" },
      }),
    ).rejects.toThrow(/m1/);
    const made = (await run(s, "manage_skill", {
      create: { title: "T", markdown: md("a") },
    })) as Skill;
    expect(made.id.startsWith("m2:")).toBe(true);
  });

  test("a throwing canCreate counts as false and is logged", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const bad = {
        ...memoryProvider("bad"),
        canCreate: () => {
          throw new TypeError("secret");
        },
      };
      const s = skillOperations({ providers: [bad, memoryProvider("ok")] });
      const r = (await run(s, "search_skills", { query: "" })) as {
        writableTargets: string[];
      };
      expect(r.writableTargets).toEqual(["ok"]);
      expect(spy).toHaveBeenCalledWith(
        "[skills] provider bad canCreate failed (TypeError)",
      );
      expect(JSON.stringify(spy.mock.calls)).not.toContain("secret");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("outages", () => {
  const down = (key: string): SkillProvider => ({
    key,
    async search() {
      throw new Error("boom");
    },
    async get() {
      throw new Error("boom");
    },
  });

  test("all-failed or nothing-found-with-failure throws unavailable; partial results return", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const empty = skillOperations({
        providers: [down("d1"), readOnly("a", ["x"])],
      });
      await expect(
        run(empty, "search_skills", { query: "nomatch" }),
      ).rejects.toThrow("Skill providers are unavailable (d1); try again.");
      await expect(run(empty, "use_skill", { slug: "nope" })).rejects.toThrow(
        "Skill providers are unavailable (d1); try again.",
      );
      const ok = (await run(empty, "search_skills", { query: "x" })) as {
        skills: unknown[];
      };
      expect(ok.skills).toHaveLength(1);
      const none = skillOperations({ providers: [readOnly("a", ["x"])] });
      await expect(run(none, "use_skill", { slug: "nope" })).rejects.toThrow(
        /No skill with slug/,
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("intent", () => {
  test("wrap passes the caller's intent to providers", async () => {
    let seen: string | undefined;
    const p: SkillProvider = {
      key: "i",
      async search(_q, c) {
        seen = c.intent;
        return [];
      },
      async get() {
        return null;
      },
    };
    const s = skillOperations({ providers: [p] });
    await s.wrap(async () => "app")(
      "search_skills",
      { query: "" },
      { ...ctx, intent: "find a skill" },
    );
    expect(seen).toBe("find a skill");
  });
});

describe("use_skill files", () => {
  const skillMd = (body = "Body.", extra = "") =>
    `---\nname: s\ndescription: d\n${extra}---\n${body}\n`;
  const setup = (
    tree: Record<string, string>,
    opts: { prefix?: string; key?: string } = {},
  ) => {
    const p = staticSkills(opts.key ?? "k", tree);
    const s = skillOperations({
      providers: [p],
      files: [p.files],
      ...(opts.prefix ? { prefix: opts.prefix } : {}),
    });
    const use = async (vars: Record<string, unknown> = { slug: "s" }) =>
      (await run(s, `${opts.prefix ?? ""}use_skill`, vars)) as Skill;
    return { p, s, use };
  };

  test("manifest, refs and uri", async () => {
    const { use } = setup({
      "s/SKILL.md": skillMd("See [x](references/a.md)."),
      "s/references/a.md": "# A\n\nAlpha.\n",
    });
    const skill = await use();
    expect(skill.uri).toBe("skills://k/s/SKILL.md");
    expect(skill.files?.map((f) => f.uri)).toEqual([
      "skills://k/s/references/a.md",
    ]);
    expect(skill.files?.every((f) => f.kind === "file")).toBe(true);
    expect(skill.refs).toEqual([
      { raw: "references/a.md", uri: "skills://k/s/references/a.md" },
    ]);
    expect(skill.moreFiles).toBeUndefined();
    const brief = renderSkillBrief(skill, "");
    expect(brief.startsWith(skill.markdown)).toBe(true);
    expect(brief).toContain("--- files (skills://k/s/SKILL.md) ---");
    expect(brief).toContain("references/a.md  ");
    expect(brief).toContain("references/a.md → skills://k/s/references/a.md");
  });

  test("includes fill included and the brief", async () => {
    const { use } = setup({
      "s/SKILL.md": skillMd(
        "Go.",
        "metadata:\n  include: references/a.md, references/b.md\n",
      ),
      "s/references/a.md": "AAA\n",
      "s/references/b.md": "BBB\n",
    });
    const skill = await use();
    expect(skill.included?.map((i) => i.path)).toEqual([
      "references/a.md",
      "references/b.md",
    ]);
    expect(skill.included?.[0]?.text).toContain("AAA");
    expect(skill.notice).toBeUndefined();
    const brief = renderSkillBrief(skill, "");
    expect(brief).toContain("--- included: references/a.md ---");
    expect(brief.indexOf("--- included: references/a.md")).toBeLessThan(
      brief.indexOf("--- included: references/b.md"),
    );
    expect(brief.indexOf("--- included: references/b.md")).toBeLessThan(
      brief.indexOf("--- files ("),
    );
  });

  test("includes and refs with a fragment or a non-ASCII name resolve", async () => {
    const { use } = setup({
      "s/SKILL.md": skillMd(
        "See [d](references/d.md#approval) and [v](tài-liệu.md).",
        "metadata:\n  include: references/d.md#approval, tài-liệu.md\n",
      ),
      "s/references/d.md": "DDD\n",
      "s/tài-liệu.md": "VVV\n",
    });
    const skill = await use();
    expect(skill.notice).toBeUndefined();
    expect(skill.included).toEqual([
      { path: "references/d.md#approval", text: "DDD" },
      { path: "tài-liệu.md", text: "VVV" },
    ]);
    expect(skill.refs).toEqual([
      {
        raw: "references/d.md#approval",
        uri: "skills://k/s/references/d.md",
      },
      { raw: "tài-liệu.md", uri: "skills://k/s/tài-liệu.md" },
    ]);
    expect(skill.files?.map((f) => f.uri)).toContain(
      "skills://k/s/tài-liệu.md",
    );
  });

  test("an include over the cap stays manifest-only with a notice", async () => {
    const line = `${"x".repeat(99)}\n`;
    const { use } = setup({
      "s/SKILL.md": skillMd(
        "Go.",
        "metadata:\n  include: references/a.md, references/b.md\n",
      ),
      "s/references/a.md": line.repeat(300),
      "s/references/b.md": line.repeat(50),
    });
    const skill = await use();
    expect(skill.included?.map((i) => i.path)).toEqual(["references/a.md"]);
    expect(skill.included?.[0]?.text.length).toBeGreaterThan(29000);
    expect(skill.notice).toContain("references/b.md");
    expect(skill.files?.map((f) => f.uri)).toContain(
      "skills://k/s/references/b.md",
    );
  });

  test("an include with a cut long line on page 1 is not inlined", async () => {
    const body = `${"y".repeat(2500)}\n${"short\n".repeat(300)}`;
    const { use } = setup({
      "s/SKILL.md": skillMd("Go.", "metadata:\n  include: references/a.md\n"),
      "s/references/a.md": body,
    });
    const skill = await use();
    expect(skill.included ?? []).toEqual([]);
    expect(skill.notice).toContain("references/a.md");
    expect(skill.files?.map((f) => f.uri)).toContain(
      "skills://k/s/references/a.md",
    );
  });

  test("a missing include adds a notice and does not throw", async () => {
    const { use } = setup({
      "s/SKILL.md": skillMd(
        "Go.",
        "metadata:\n  include: references/nope.md\n",
      ),
      "s/references/a.md": "A\n",
    });
    const skill = await use();
    expect(skill.included ?? []).toEqual([]);
    expect(skill.notice).toContain("references/nope.md");
    expect(skill.notice).not.toContain("read_file");
    const brief = renderSkillBrief(skill, "mt_");
    expect(brief).toMatch(/include references\/nope\.md .*mt_read_file/);
    expect(brief).not.toMatch(/(?<![\w])read_file\b/);
  });

  test("a binary include is skipped with a notice", async () => {
    const files: FileProvider = staticFiles("skills", {
      "k/s/SKILL.md": skillMd("Go.", "metadata:\n  include: pic.png\n"),
      "k/s/pic.png": { url: "https://x/p.png", mime: "image/png", bytes: 10 },
    });
    const p = staticSkills("k", {
      "s/SKILL.md": skillMd("Go.", "metadata:\n  include: pic.png\n"),
    });
    const s = skillOperations({ providers: [p], files: [files] });
    const skill = (await run(s, "use_skill", { slug: "s" })) as Skill;
    expect(skill.included ?? []).toEqual([]);
    expect(skill.notice).toContain("pic.png");
    const png = skill.files?.find((f) => f.uri.endsWith("pic.png"));
    expect(png?.mime).toBe("image/png");
    expect(png?.lines).toBeUndefined();
    expect(renderSkillBrief(skill, "")).toContain("image/png");
  });

  test("a manifest over 50 entries reports the surplus", async () => {
    const tree: Record<string, string> = { "s/SKILL.md": skillMd() };
    for (let i = 0; i < 60; i++) {
      tree[`s/f${String(i).padStart(2, "0")}.md`] = `f${i}\n`;
    }
    const { use } = setup(tree);
    const skill = await use();
    expect(skill.files).toHaveLength(50);
    expect(skill.moreFiles).toBe(10);
    expect(renderSkillBrief(skill, "mt_")).toContain(
      "10 more — mt_list_files { uri: skills://k/s/ }",
    );
  });

  test("without files the output is markdown only", async () => {
    const p = staticSkills("k", {
      "s/SKILL.md": skillMd("Go.", "metadata:\n  include: a.md\n"),
      "s/a.md": "A\n",
    });
    const s = skillOperations({ providers: [p] });
    const skill = (await run(s, "use_skill", { slug: "s" })) as Skill;
    expect(Object.keys(skill).sort()).toEqual(
      ["description", "hash", "id", "markdown", "name", "slug", "uri"].sort(),
    );
    expect(renderSkillBrief(skill, "")).toBe(skill.markdown);
    const node = JSON.stringify(
      s.operations.use_skill({ data: skill, variables: {} }),
    );
    expect(node).not.toContain("--- files");
  });

  test("a provider for another scheme leaves the skill as is", async () => {
    const p = staticSkills("k", { "s/SKILL.md": skillMd() });
    const other = staticFiles("other", { "k/s/a.md": "A\n" });
    const s = skillOperations({ providers: [p], files: [other] });
    const skill = (await run(s, "use_skill", { slug: "s" })) as Skill;
    expect(skill.files).toBeUndefined();
    expect(skill.refs).toBeUndefined();
  });

  test("hash stays the hash of SKILL.md", async () => {
    const { use } = setup({
      "s/SKILL.md": skillMd("Go.", "metadata:\n  include: a.md\n"),
      "s/a.md": "A\n",
    });
    const skill = await use();
    expect(skill.hash).toBe(await skillHash(skill.markdown));
  });

  test("the footer names the prefixed read_file and the brief is wired", async () => {
    const { s, use } = setup(
      { "s/SKILL.md": skillMd(), "s/a.md": "A\n" },
      { prefix: "mt_" },
    );
    const skill = await use();
    const brief = renderSkillBrief(skill, "mt_");
    expect(brief).toContain(
      'Read a listed file with mt_read_file { path: "<path as listed above>", base: "skills://k/s/SKILL.md" }.',
    );
    expect(brief).toContain(
      "Relative links in SKILL.md resolve against its uri, skills://k/s/SKILL.md;",
    );
    const node = JSON.stringify(
      s.operations.mt_use_skill({ data: skill, variables: {} }),
    );
    expect(node).toContain("mt_read_file");
    expect(node).toContain("--- files (");
  });

  test("a key with underscore, hyphen and capitals round-trips", async () => {
    const { use } = setup(
      {
        "s/SKILL.md": skillMd(
          "See [x](references/a.md).",
          "metadata:\n  include: references/a.md\n",
        ),
        "s/references/a.md": "A\n",
      },
      { key: "My_key-1" },
    );
    const skill = await use();
    expect(skill.uri).toBe("skills://My_key-1/s/SKILL.md");
    expect(skill.files).toHaveLength(1);
    expect(skill.refs).toHaveLength(1);
    expect(skill.included?.map((i) => i.path)).toEqual(["references/a.md"]);
  });

  test("a throwing list leaves the markdown without a manifest", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const inner = staticFiles("skills", { "k/s/SKILL.md": skillMd() });
      const files: FileProvider = {
        ...inner,
        async list() {
          throw new Error("secret-boom");
        },
      };
      const p = staticSkills("k", { "s/SKILL.md": skillMd() });
      const s = skillOperations({ providers: [p], files: [files] });
      const skill = (await run(s, "use_skill", { slug: "s" })) as Skill;
      expect(skill.markdown).toBe(skillMd());
      expect(skill.files).toBeUndefined();
      const text = renderSkillBrief(skill, "");
      expect(text).not.toContain("secret-boom");
      expect(JSON.stringify(skill)).not.toContain("secret-boom");
    } finally {
      spy.mockRestore();
    }
  });

  describe("includes stay inside the skill folder", () => {
    const inc = (paths: string) =>
      skillMd("Go.", `metadata:\n  include: ${paths}\n`);
    const spied = (
      tree: Record<string, string>,
      extra: FileProvider[] = [],
    ) => {
      const p = staticSkills("k", tree);
      const read = vi.fn(p.files.read.bind(p.files));
      const files: FileProvider = { ...p.files, read };
      const s = skillOperations({ providers: [p], files: [files, ...extra] });
      return {
        read,
        use: async () => (await run(s, "use_skill", { slug: "s" })) as Skill,
      };
    };
    const tree = {
      "s/SKILL.md": inc(
        "../x.md, skills://other/s/x.md, skills://k/other/x.md, references/../a.md",
      ),
      "s/a.md": "AAA\n",
      "x.md": "OUTSIDE\n",
      "other/x.md": "SIBLING\n",
    };

    test("outside includes are not read and add a fixed notice", async () => {
      const { use, read } = spied(tree);
      const skill = await use();
      expect(skill.included).toEqual([
        { path: "references/../a.md", text: "AAA" },
      ]);
      for (const path of [
        "../x.md",
        "skills://other/s/x.md",
        "skills://k/other/x.md",
      ]) {
        expect(skill.notice).toContain(
          `Include ${path} is outside the skill folder and was not included.`,
        );
      }
      const uris = read.mock.calls.map((c) => c[0]);
      expect(uris).toEqual(["skills://k/s/a.md"]);
      const brief = renderSkillBrief(skill, "mt_");
      expect(brief).toContain(
        "Include ../x.md is outside the skill folder and was not included.",
      );
      expect(brief).not.toContain("OUTSIDE");
      expect(brief).not.toContain("SIBLING");
      expect(brief).not.toMatch(/outside the skill folder.*read_file/);
    });
  });

  describe("parts fail independently", () => {
    const withList = (list: FileProvider["list"]) => {
      const tree = {
        "s/SKILL.md": skillMd("See [a](a.md).", "metadata:\n  include: a.md\n"),
        "s/a.md": "AAA\n",
      };
      const p = staticSkills("k", tree);
      const files: FileProvider = { ...p.files, list };
      return skillOperations({
        providers: [p],
        files: [files],
        prefix: "mt_",
      });
    };

    test("a failing list still returns includes, refs and a notice", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const s = withList(async () => {
          throw new Error("secret-boom");
        });
        const skill = (await run(s, "mt_use_skill", { slug: "s" })) as Skill;
        expect(skill.files).toBeUndefined();
        expect(skill.included).toEqual([{ path: "a.md", text: "AAA" }]);
        expect(skill.refs).toEqual([{ raw: "a.md", uri: "skills://k/s/a.md" }]);
        const brief = renderSkillBrief(skill, "mt_");
        expect(brief).toContain("--- included: a.md ---");
        expect(brief).toContain("--- files (skills://k/s/SKILL.md) ---");
        expect(brief).toContain(
          "The file list could not be loaded; try mt_list_files { uri: skills://k/s/ }.",
        );
        expect(brief).not.toMatch(/(?<![\w])list_files\b/);
        expect(brief).not.toContain("secret-boom");
        expect(JSON.stringify(skill)).not.toContain("secret-boom");
        expect(JSON.stringify(spy.mock.calls)).not.toContain("secret-boom");
      } finally {
        spy.mockRestore();
      }
    });

    test("an unparseable skill uri returns the plain skill", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const bad: SkillProvider = {
          key: "k",
          async search() {
            return [];
          },
          async get() {
            return {
              id: "s",
              slug: "s",
              name: "s",
              description: "d",
              hash: "h",
              markdown: skillMd("See [a](a.md)."),
              uri: "skills://[bad/SKILL.md",
            };
          },
        };
        const files = staticFiles("skills", { "k/s/a.md": "A\n" });
        const s = skillOperations({ providers: [bad], files: [files] });
        const skill = (await run(s, "use_skill", { slug: "s" })) as Skill;
        expect(skill.markdown).toBe(skillMd("See [a](a.md)."));
        expect(skill.included).toBeUndefined();
        expect(skill.refs ?? []).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

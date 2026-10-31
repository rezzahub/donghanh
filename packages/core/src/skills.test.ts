import { describe, expect, spyOn, test } from "bun:test";
import { App } from "./primitives";
import { buildRegistry } from "./registry";
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
  staticSkills(key, Object.fromEntries(names.map((n) => [n, md(n)])));

describe("parseSkillMarkdown", () => {
  test("parseSkillMarkdown requires name and description frontmatter", () => {
    expect(parseSkillMarkdown(md("a-b", "Does it", "Hello"))).toEqual({
      name: "a-b",
      description: "Does it",
      body: "Hello\n",
    });
    expect(() => parseSkillMarkdown("no frontmatter")).toThrow(/frontmatter/);
    expect(() => parseSkillMarkdown("---\nname: x\n---\nb")).toThrow(
      /description/,
    );
    expect(() => parseSkillMarkdown("---\ndescription: x\n---\nb")).toThrow(
      /name/,
    );
  });

  test("staticSkills rejects a bad slug", () => {
    expect(() => staticSkills("k", { a: md("Bad Name") })).toThrow(/slug/);
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
      providers: [staticSkills("a", { x: markdown })],
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
    const spy = spyOn(console, "error").mockImplementation(() => {});
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
      expect(spy).toHaveBeenCalledWith("[skills] provider bad search failed");
      expect(spy).toHaveBeenCalledWith("[skills] provider bad get failed");
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
    const ops: Record<string, OperationComponent> = {
      mine: skills.operations.search_skills,
    };
    expect(() =>
      buildRegistry(App({ operations: { ...ops, ...skills.operations } })),
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
});

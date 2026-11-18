import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type Skill, skillOperations, staticSkills } from "../skills";
import type { OperationComponent } from "../types";
import { fileOperations } from "./operations";
import type { FileProvider } from "./types";

// An agent-style loop over a skills tree with prefixed tools: load a skill,
// follow every ref, page a long file, grep, re-read a hit. Every tool name the
// agent is shown must be one it can call.

const ctx = { userId: "u1", request: new Request("http://x/") };
const PREFIX = "x_";
const BARE =
  /(?<![\w])(list_files|read_file|grep_files|search_files|use_skill)\b/;

const big = `${Array.from({ length: 1234 }, (_, i) =>
  i === 700 ? "x".repeat(5000) : `line ${i + 1} ${"y".repeat(i % 90)}`,
).join("\r\n")}\r\n`;

const tree = {
  "pricing/SKILL.md": `---
name: pricing
description: Pricing rules.
metadata:
  include: references/plans.md#starter, tài-liệu.md, references/missing.md
---

# Pricing

See [plans](references/plans.md), [discounts](references/discounts.md#approval),
[notes](tài-liệu.md) and [the log](references/big.md).
`,
  "pricing/references/plans.md": "# Plans\n\nStarter, Team.\n",
  "pricing/references/discounts.md": "# Discounts\n\nAPPROVE above 10%.\n",
  "pricing/tài-liệu.md": "# Tài liệu\n\nGhi chú.\n",
  "pricing/references/big.md": big,
};

type Read = {
  uri: string;
  text?: string;
  lines?: { from: number; to: number; total: number };
  next?: { uri: string; offset: number; limit?: number };
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
});

describe("agent loop with prefixed tools", () => {
  const team = staticSkills("team", tree);
  const files: FileProvider = {
    ...team.files,
    async search() {
      return [];
    },
  };
  const skills = skillOperations({
    providers: [team],
    files: [files],
    prefix: PREFIX,
  });
  const fileOps = fileOperations({ providers: [files], prefix: PREFIX });
  const operations: Record<string, OperationComponent> = {
    ...skills.operations,
    ...fileOps.operations,
  };
  const exec = fileOps.wrap(
    skills.wrap(async (id) => {
      throw new Error(`unknown operation ${id}`);
    }),
  );
  const call = (id: string, vars: Record<string, unknown>) =>
    exec(`${PREFIX}${id}`, vars, ctx);
  const shown = (id: string, data: unknown): string =>
    (
      operations[`${PREFIX}${id}`]({ data, variables: {} }) as {
        children: { content: string }[];
      }
    ).children
      .map((c) => c.content)
      .join("\n");

  test("load, follow refs, page, grep, and only name tools that exist", async () => {
    const texts: string[] = [fileOps.instructions];
    for (const op of Object.values(operations)) {
      texts.push(
        op.operationConfig.instruction ?? "",
        op.operationConfig.description ?? "",
      );
    }

    // Load the skill.
    const skill = (await call("use_skill", { slug: "pricing" })) as Skill;
    const brief = shown("use_skill", skill);
    texts.push(brief, skill.notice ?? "");
    expect(skill.included?.map((i) => i.path)).toEqual([
      "references/plans.md#starter",
      "tài-liệu.md",
    ]);
    expect(skill.notice).toContain("references/missing.md");
    expect(brief).toContain(`${PREFIX}read_file`);

    // Follow every ref from the table.
    expect(skill.refs?.length).toBe(4);
    for (const ref of skill.refs ?? []) {
      const r = (await call("read_file", { uri: ref.uri })) as Read;
      expect(r.uri).toBe(ref.uri);
      texts.push(shown("read_file", r));
    }
    // Read every listed file the way the footer says: path as listed + base.
    const folder = (skill.uri as string).replace(/SKILL\.md$/, "");
    for (const f of skill.files ?? []) {
      const path = f.uri.slice(folder.length);
      const r = (await call("read_file", { path, base: skill.uri })) as Read;
      expect(r.uri).toBe(f.uri);
    }

    // Page the long file via next until done: every line exactly once.
    const bigUri = `${folder}references/big.md`;
    let args: Record<string, unknown> = { uri: bigUri };
    const seen: number[] = [];
    let total = 0;
    for (let pages = 0; ; pages++) {
      expect(pages).toBeLessThan(100);
      const r = (await call("read_file", args)) as Read;
      texts.push(shown("read_file", r));
      total = r.lines?.total ?? 0;
      for (let n = r.lines?.from ?? 1; n <= (r.lines?.to ?? 0); n++) {
        seen.push(n);
      }
      if (!r.next) break;
      args = r.next;
    }
    expect(total).toBe(1234);
    expect(seen).toEqual(Array.from({ length: total }, (_, i) => i + 1));

    // Grep, then re-read the hit by offset.
    const grep = (await call("grep_files", {
      uri: folder,
      pattern: "^line 1000 |APPROVE",
    })) as { hits: { uri: string; line: number }[] };
    texts.push(shown("grep_files", grep));
    const hit = grep.hits.find((h) => h.uri === bigUri);
    expect(hit?.line).toBe(1000);
    expect(grep.hits.map((h) => h.uri)).toContain(
      `${folder}references/discounts.md`,
    );
    const again = (await call("read_file", {
      uri: bigUri,
      offset: hit?.line,
      limit: 1,
    })) as Read;
    expect(again.text?.startsWith("line 1000 ")).toBe(true);

    // Engine errors the agent can hit.
    const failures: [string, Record<string, unknown>][] = [
      ["read_file", { uri: `${folder}nope.md` }],
      ["read_file", { path: "nope.md" }],
      ["list_files", { uri: "skills://nope/" }],
      ["grep_files", { uri: "skills://nope/", pattern: "x" }],
    ];
    for (const [id, vars] of failures) {
      const message = await call(id, vars).then(
        () => "",
        (e: Error) => e.message,
      );
      expect(message).not.toBe("");
      texts.push(message);
    }

    // Every prefixed tool named exists; no bare tool name appears.
    const registered = new Set(Object.keys(operations));
    for (const text of texts) {
      for (const [name] of text.matchAll(/\bx_\w+/g)) {
        expect(registered, `${name} in: ${text}`).toContain(name);
      }
      expect(text, text).not.toMatch(BARE);
    }
  });
});

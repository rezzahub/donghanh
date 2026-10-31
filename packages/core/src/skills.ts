import { Brief, Message } from "./primitives";
import type { Executor, OperationComponent } from "./types";
import { registerOperation } from "./types";

export interface SkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  hash: string;
  /** Key of the provider that can change this skill for the caller, if any. */
  writableBy?: string;
}

export interface Skill extends SkillSummary {
  markdown: string;
  files?: Record<string, string>;
}

export interface SkillContext {
  /** Null when the caller is unauthenticated. Through gptRoutes an anonymous caller arrives as the string "anonymous", not null. */
  userId: string | null;
  request: Request;
  /** The caller's stated reason for the call, when the host passes one. */
  intent?: string;
}

export interface SkillProvider {
  key: string;
  search(query: string, ctx: SkillContext): Promise<SkillSummary[]>;
  get(slug: string, ctx: SkillContext): Promise<Skill | null>;
  /** Whether this caller may create here. Defaults to true when `create` exists. */
  canCreate?(ctx: SkillContext): boolean | Promise<boolean>;
  create?(
    input: { title: string; markdown: string },
    ctx: SkillContext,
  ): Promise<Skill>;
  update?(
    id: string,
    input: { title: string; markdown: string },
    ctx: SkillContext,
  ): Promise<Skill>;
  delete?(id: string, ctx: SkillContext): Promise<void>;
}

const MAX_MARKDOWN = 65536;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z0-9_-]+$/;

/** SHA-256 of the Markdown as hex, first 12 characters. */
export async function skillHash(markdown: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(markdown),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 12);
}

/** Minimal frontmatter: a `---` block of `key: value` lines, then the body. */
export function parseSkillMarkdown(md: string): {
  name: string;
  description: string;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) throw new Error("SKILL.md must start with a --- frontmatter block");
  const fields: Record<string, string> = {};
  const continued = new Set<string>();
  let last = "";
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s/.test(line)) {
      if (line.trim() && (last === "name" || last === "description")) {
        continued.add(last);
      }
      continue;
    }
    const i = line.indexOf(":");
    if (i < 1) {
      last = "";
      continue;
    }
    last = line.slice(0, i).trim();
    fields[last] = line
      .slice(i + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2");
  }
  for (const key of ["name", "description"]) {
    if (continued.has(key) || /^[>|][+-]?\d*$/.test(fields[key] ?? "")) {
      throw new Error(
        `SKILL.md frontmatter ${key} must be a single line; folded and literal YAML (">-", "|") is not supported`,
      );
    }
  }
  if (!fields.name) throw new Error("SKILL.md frontmatter needs a name");
  if (!fields.description) {
    throw new Error("SKILL.md frontmatter needs a description");
  }
  return { name: fields.name, description: fields.description, body: m[2] };
}

/** Read-only provider over SKILL.md strings. Slug = frontmatter name; id = slug. */
export function staticSkills(
  key: string,
  files: Record<string, string>,
): SkillProvider {
  const skills = new Map<string, Promise<Skill>>();
  for (const markdown of Object.values(files)) {
    const { name, description } = parseSkillMarkdown(markdown);
    if (!SLUG.test(name)) {
      throw new Error(
        `Skill slug "${name}" must be lowercase letters, digits and single hyphens`,
      );
    }
    skills.set(
      name,
      skillHash(markdown).then((hash) => ({
        id: name,
        slug: name,
        name,
        description,
        hash,
        markdown,
      })),
    );
  }
  const summarize = ({ markdown: _m, files: _f, ...s }: Skill): SkillSummary =>
    s;
  return {
    key,
    async search(query) {
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const all = await Promise.all(skills.values());
      return all
        .filter((s) => {
          if (!tokens.length) return true;
          const hay = `${s.slug} ${s.name} ${s.description}`.toLowerCase();
          return tokens.some((t) => hay.includes(t));
        })
        .map(summarize);
    },
    async get(slug) {
      return (await skills.get(slug)) ?? null;
    },
  };
}

type Handler = (
  vars: Record<string, unknown>,
  ctx: SkillContext,
) => Promise<unknown>;

const manageInstruction = (search: string, use: string) =>
  "Use only when the user explicitly asks to create or change a skill. " +
  "Pass exactly one of create or update. update needs the exact id from " +
  search +
  " or " +
  use +
  "; " +
  "never fall back to create when an update fails. Pass the complete SKILL.md (frontmatter name and description, then the body). " +
  "create takes an optional target, one of writableTargets from " +
  search +
  "; without it the first writable provider is used. " +
  "Never delete duplicates automatically.";

function textBrief(text: string) {
  return Brief({ children: [Message({ children: text })] });
}

export function skillOperations(opts: {
  providers: SkillProvider[];
  prefix?: string;
  auth?: "none" | "optional" | "required";
}): {
  operations: Record<string, OperationComponent>;
  wrap(executor: Executor): Executor;
} {
  const { providers } = opts;
  const prefix = opts.prefix ?? "";
  const seen = new Set<string>();
  for (const p of providers) {
    if (!KEY.test(p.key)) {
      throw new Error(
        `Skill provider key "${p.key}" must use letters, digits, "_" or "-"`,
      );
    }
    if (seen.has(p.key)) {
      throw new Error(`Skill provider keys must be unique: "${p.key}"`);
    }
    seen.add(p.key);
  }
  const writable = providers.filter((p) => p.create || p.update || p.delete);
  const creators = providers.filter((p) => p.create);
  const unavailable = (keys: string[]) =>
    new Error(
      `Skill providers are unavailable (${keys.join(", ")}); try again.`,
    );
  const byKey = new Map(providers.map((p) => [p.key, p]));

  const fail = (p: SkillProvider, method: string, e: unknown) =>
    console.error(
      `[skills] provider ${p.key} ${method} failed (${e instanceof Error ? e.name : "Error"})`,
    );

  /** Creators this caller may use; a throwing canCreate counts as false. */
  async function creatorsFor(ctx: SkillContext): Promise<SkillProvider[]> {
    const ok = await Promise.all(
      creators.map(async (p) => {
        if (!p.canCreate) return true;
        try {
          return await p.canCreate(ctx);
        } catch (e) {
          fail(p, "canCreate", e);
          return false;
        }
      }),
    );
    return creators.filter((_, i) => ok[i]);
  }

  const ns = <T extends SkillSummary>(p: SkillProvider, s: T): T => ({
    ...s,
    id: `${p.key}:${s.id}`,
  });

  function route(id: unknown): { provider: SkillProvider; raw: string } {
    if (typeof id !== "string" || !id) {
      throw new Error(
        `id is required (use the exact id from ${prefix}search_skills)`,
      );
    }
    const i = id.indexOf(":");
    if (i < 1) {
      throw new Error(
        `Invalid id "${id}": ids look like "<provider>:<id>"; use the exact id from ${prefix}search_skills`,
      );
    }
    const provider = byKey.get(id.slice(0, i));
    if (!provider) {
      throw new Error(
        `Unknown provider "${id.slice(0, i)}" in id "${id}"; use the exact id from ${prefix}search_skills`,
      );
    }
    return { provider, raw: id.slice(i + 1) };
  }

  function checkInput(
    v: unknown,
    what: string,
  ): { title: string; markdown: string } {
    const o = v as { title?: unknown; markdown?: unknown } | null;
    if (!o || typeof o !== "object")
      throw new Error(`${what} must be an object`);
    if (typeof o.title !== "string" || !o.title) {
      throw new Error(`${what}.title is required`);
    }
    if (typeof o.markdown !== "string" || !o.markdown) {
      throw new Error(`${what}.markdown is required`);
    }
    if (o.markdown.length > MAX_MARKDOWN) {
      throw new Error(
        `${what}.markdown is over ${MAX_MARKDOWN} characters; shorten the SKILL.md`,
      );
    }
    parseSkillMarkdown(o.markdown);
    return { title: o.title, markdown: o.markdown };
  }

  const handlers: Record<string, Handler> = {
    async search_skills(vars, ctx) {
      const query = typeof vars.query === "string" ? vars.query : "";
      const raw =
        typeof vars.limit === "number" ? Math.floor(vars.limit) : DEFAULT_LIMIT;
      const limit = Math.min(MAX_LIMIT, Math.max(1, raw));
      const failed: string[] = [];
      const lists = await Promise.all(
        providers.map(async (p) => {
          try {
            return (await p.search(query, ctx)).map((s) => ({
              ...ns(p, s),
              provider: p.key,
            }));
          } catch (e) {
            fail(p, "search", e);
            failed.push(p.key);
            return [];
          }
        }),
      );
      const slugs = new Set<string>();
      const skills: (SkillSummary & { provider: string })[] = [];
      for (const s of lists.flat()) {
        if (slugs.has(s.slug)) continue;
        slugs.add(s.slug);
        skills.push(s);
      }
      if (failed.length && !skills.length) throw unavailable(failed);
      return {
        skills: skills.slice(0, limit),
        writableTargets: (await creatorsFor(ctx)).map((p) => p.key),
      };
    },
    async use_skill(vars, ctx) {
      const slug = vars.slug;
      if (typeof slug !== "string" || !slug)
        throw new Error("slug is required");
      let asked = providers;
      if (vars.provider != null) {
        const only = byKey.get(String(vars.provider));
        if (!only) {
          throw new Error(
            `Unknown provider "${String(vars.provider)}"; providers: ${providers.map((p) => p.key).join(", ")}`,
          );
        }
        asked = [only];
      }
      const failed: string[] = [];
      for (const p of asked) {
        try {
          const s = await p.get(slug, ctx);
          if (s) return ns(p, s);
        } catch (e) {
          fail(p, "get", e);
          failed.push(p.key);
        }
      }
      if (failed.length) throw unavailable(failed);
      throw new Error(
        `No skill with slug "${slug}"; call ${prefix}search_skills first`,
      );
    },
    async manage_skill(vars, ctx) {
      const { create, update } = vars as { create?: unknown; update?: unknown };
      if ((create == null) === (update == null)) {
        throw new Error("Pass exactly one of create or update");
      }
      if (create != null) {
        const input = checkInput(create, "create");
        const target = (create as { target?: unknown }).target;
        const usable = await creatorsFor(ctx);
        let provider: SkillProvider | undefined;
        if (target != null) {
          provider = usable.find((p) => p.key === target);
          if (!provider) {
            throw new Error(
              `Unknown target "${String(target)}"; writable targets: ${usable.map((p) => p.key).join(", ") || "none"}`,
            );
          }
        } else {
          provider = usable[0];
          if (!provider)
            throw new Error("No writable provider can create skills");
        }
        return ns(
          provider,
          await (provider.create as NonNullable<SkillProvider["create"]>)(
            input,
            ctx,
          ),
        );
      }
      const u = update as { id?: unknown };
      const input = checkInput(update, "update");
      const { provider, raw } = route(u.id);
      if (!provider.update)
        throw new Error(`Provider "${provider.key}" is read-only`);
      return ns(provider, await provider.update(raw, input, ctx));
    },
    async delete_skill(vars, ctx) {
      const { provider, raw } = route(vars.id);
      if (!provider.delete)
        throw new Error(`Provider "${provider.key}" is read-only`);
      await provider.delete(raw, ctx);
      return { deleted: String(vars.id) };
    },
  };

  const operations: Record<string, OperationComponent> = {};
  const base = { auth: opts.auth } as const;
  const define = (
    name: string,
    component: Parameters<typeof registerOperation>[0],
    config: Omit<Parameters<typeof registerOperation>[1], "id" | "auth">,
  ) => {
    const id = prefix + name;
    operations[id] = registerOperation(component, {
      ...config,
      id,
      ...(base.auth ? base : {}),
    });
  };

  define(
    "search_skills",
    ({ data }) => {
      const d = data as {
        skills: (SkillSummary & { provider?: string })[];
        writableTargets: string[];
      };
      const lines = d.skills.map(
        (s) =>
          `- ${s.id}: ${s.name} - ${s.description}${s.provider ? ` [provider ${s.provider}]` : ""}${s.writableBy ? ` [writable by ${s.writableBy}]` : ""}`,
      );
      if (!lines.length) lines.push("No skills found.");
      if (d.writableTargets.length) {
        lines.push(`Writable targets: ${d.writableTargets.join(", ")}`);
      }
      return textBrief(lines.join("\n"));
    },
    {
      type: "query",
      title: "Search skills",
      description: "Search the skills available to this user by keyword.",
      instruction: `Search skills before starting a kind of task. Pass a few keywords. Then call ${prefix}use_skill with the slug of a match.`,
      input: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keywords describing the task",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: MAX_LIMIT,
            description: "Max results (default 5)",
          },
        },
        required: ["query"],
      },
      responseKey: "skills",
      idempotent: true,
    },
  );

  define("use_skill", ({ data }) => textBrief((data as Skill).markdown), {
    type: "query",
    title: "Use skill",
    description: "Load a skill's full SKILL.md by slug.",
    instruction: `Keep it in context and follow it as guidance while using the normal tools. Pass provider when ${prefix}search_skills showed one, so the copy you saw is the one you load.`,
    input: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: `Slug from ${prefix}search_skills`,
        },
        provider: {
          type: "string",
          description: `Provider key shown by ${prefix}search_skills`,
        },
      },
      required: ["slug"],
    },
    responseKey: "skill",
    idempotent: true,
  });

  if (writable.length) {
    define(
      "manage_skill",
      ({ data }) => {
        const s = data as Skill;
        return textBrief(`Saved skill ${s.id} (${s.name}, hash ${s.hash}).`);
      },
      {
        type: "mutation",
        title: "Create or update skill",
        description: "Create a new skill or update an existing one.",
        instruction: manageInstruction(
          `${prefix}search_skills`,
          `${prefix}use_skill`,
        ),
        input: {
          type: "object",
          properties: {
            create: {
              type: "object",
              properties: {
                title: { type: "string" },
                markdown: { type: "string", description: "Complete SKILL.md" },
                target: {
                  type: "string",
                  description: "Writable provider key",
                },
              },
              required: ["title", "markdown"],
            },
            update: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: `Exact id from ${prefix}search_skills or ${prefix}use_skill`,
                },
                title: { type: "string" },
                markdown: { type: "string", description: "Complete SKILL.md" },
              },
              required: ["id", "title", "markdown"],
            },
          },
        },
        responseKey: "skill",
      },
    );
    define(
      "delete_skill",
      ({ data }) =>
        textBrief(`Deleted skill ${(data as { deleted: string }).deleted}.`),
      {
        type: "mutation",
        title: "Delete skill",
        description: "Delete a skill by id.",
        instruction: `Only when the user explicitly asks. Use the exact id from ${prefix}search_skills. Never delete duplicates automatically.`,
        input: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: `Exact id from ${prefix}search_skills`,
            },
          },
          required: ["id"],
        },
        responseKey: "skill",
        destructive: true,
      },
    );
  }

  return {
    operations,
    wrap(executor) {
      return (operationId, variables, context) => {
        const name = operationId.startsWith(prefix)
          ? operationId.slice(prefix.length)
          : "";
        if (
          name &&
          Object.hasOwn(operations, operationId) &&
          Object.hasOwn(handlers, name)
        ) {
          return handlers[name](variables, {
            userId: context.userId,
            request: context.request,
            ...(context.intent !== undefined && { intent: context.intent }),
          });
        }
        return executor(operationId, variables, context);
      };
    },
  };
}

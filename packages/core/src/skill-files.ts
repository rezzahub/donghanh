import {
  extractRefs,
  FILE_LIMITS,
  type FileContext,
  type FileEntry,
  type FileProvider,
  listFiles,
  readFile,
  resolveRef,
  uriScheme,
} from "./files";
import { parseSkillMarkdown, type Skill } from "./skills";

const encoder = new TextEncoder();
const MAX_LIST_PAGES = 20;
const DEEP = 100;

/** Folder part of a uri, with its trailing slash. */
const folderOf = (uri: string): string =>
  uri.slice(0, uri.lastIndexOf("/") + 1);

const failed = (what: string, e: unknown) =>
  console.error(
    `[skills] ${what} failed (${e instanceof Error ? e.name : "Error"})`,
  );

async function manifest(
  providers: FileProvider[],
  folder: string,
  skillUri: string,
  ctx: FileContext,
): Promise<{ files: FileEntry[]; moreFiles?: number }> {
  const all: FileEntry[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const r = await listFiles(
      providers,
      {
        uri: folder,
        depth: DEEP,
        limit: FILE_LIMITS.listMax,
        ...(after ? { after } : {}),
      },
      ctx,
    );
    for (const e of r.entries) {
      if (e.kind === "file" && e.uri !== skillUri) all.push(e);
    }
    if (!r.next) break;
    after = r.next;
  }
  all.sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0));
  const max = FILE_LIMITS.manifestMax;
  return {
    files: all.slice(0, max),
    ...(all.length > max ? { moreFiles: all.length - max } : {}),
  };
}

type Included = { text: string } | { why: string };

/** Read a whole text file through the engine, giving up once it passes the budget. */
async function readWhole(
  providers: FileProvider[],
  uri: string,
  budget: number,
  ctx: FileContext,
): Promise<Included> {
  const parts: string[] = [];
  let offset = 1;
  for (;;) {
    let r: Awaited<ReturnType<typeof readFile>>;
    try {
      r = await readFile(providers, { uri, offset }, ctx);
    } catch {
      return { why: "could not be read (missing or unavailable)" };
    }
    if (r.kind === "binary" || r.text === undefined) {
      return { why: "is binary" };
    }
    if (r.bytes > budget) return { why: "would exceed the inline size limit" };
    parts.push(r.text);
    const text = parts.join("\n");
    if (encoder.encode(text).length > budget) {
      return { why: "would exceed the inline size limit" };
    }
    if (!r.next) {
      return r.truncated
        ? { why: "has lines too long to include whole" }
        : { text };
    }
    offset = r.next.offset;
  }
}

async function includes(
  providers: FileProvider[],
  skill: Skill & { uri: string },
  ctx: FileContext,
): Promise<{ included: { path: string; text: string }[]; notice: string[] }> {
  const included: { path: string; text: string }[] = [];
  const notice: string[] = [];
  let raw: string | undefined;
  try {
    raw = parseSkillMarkdown(skill.markdown).metadata.include;
  } catch {
    return { included, notice };
  }
  let used = 0;
  const seen = new Set<string>();
  for (const path of (raw ?? "").split(",").map((p) => p.trim())) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const r = await readWhole(
      providers,
      resolveRef(skill.uri, path),
      FILE_LIMITS.includeBytes - used,
      ctx,
    );
    if ("why" in r) {
      notice.push(`include ${path} ${r.why}; read it with read_file.`);
      continue;
    }
    used += encoder.encode(r.text).length;
    included.push({ path, text: r.text });
  }
  return { included, notice };
}

/**
 * Add the skill's file manifest, refs and included files. Without a uri or a
 * provider for its scheme the skill comes back unchanged; a failing provider
 * degrades to the bare skill.
 */
export async function attachSkillFiles(
  skill: Skill,
  files: FileProvider[],
  ctx: FileContext,
): Promise<Skill> {
  const { uri } = skill;
  if (!uri) return skill;
  const scheme = uriScheme(uri);
  const matching = files.filter((p) => p.scheme === scheme);
  if (!matching.length) return skill;
  const out: Skill = { ...skill, refs: extractRefs(skill.markdown, uri) };
  const folder = folderOf(uri);
  try {
    Object.assign(out, await manifest(matching, folder, uri, ctx));
  } catch (e) {
    failed("manifest", e);
    return out;
  }
  const inc = await includes(matching, { ...skill, uri }, ctx);
  if (inc.included.length) out.included = inc.included;
  if (inc.notice.length) out.notice = inc.notice.join("\n");
  return out;
}

const relative = (uri: string, folder: string): string =>
  uri.startsWith(folder) ? uri.slice(folder.length) : uri;

function manifestLine(e: FileEntry, folder: string): string {
  const parts = [relative(e.uri, folder)];
  if (e.bytes !== undefined) parts.push(`${e.bytes}B`);
  if (e.lines !== undefined) parts.push(`${e.lines} lines`);
  else if (e.mime) parts.push(e.mime);
  if (e.description) parts.push(e.description);
  return parts.join("  ");
}

/** SKILL.md verbatim, then included files, then a footer describing the files. */
export function renderSkillBrief(skill: Skill, prefix: string): string {
  const out = [skill.markdown];
  for (const i of skill.included ?? []) {
    out.push(`--- included: ${i.path} ---\n${i.text}`);
  }
  const { uri } = skill;
  if (!uri || !skill.refs) return out.join("\n");
  const folder = folderOf(uri);
  const foot = [`--- files (${uri}) ---`];
  for (const e of skill.files ?? []) foot.push(manifestLine(e, folder));
  if (skill.moreFiles) {
    foot.push(
      `${skill.moreFiles} more — ${prefix}list_files { uri: ${folder} }`,
    );
  }
  for (const r of skill.refs ?? []) foot.push(`${r.raw} → ${r.uri}`);
  if (skill.notice) foot.push(...skill.notice.split("\n"));
  foot.push(
    `Relative paths resolve against the file that contains them; read files with ${prefix}read_file { uri }.`,
  );
  return `${out.join("\n")}\n\n${foot.join("\n")}`;
}

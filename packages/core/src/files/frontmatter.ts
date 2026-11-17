export interface Frontmatter {
  fields: Record<string, string>;
  metadata: Record<string, string>;
  folded: string[];
  body: string;
}

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

/**
 * Minimal frontmatter: a leading `---` block of `key: value` lines, then the
 * body. Returns null when there is no such block.
 */
export function parseFrontmatter(md: string): Frontmatter | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return null;
  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  const continued = new Set<string>();
  let last = "";
  for (const line of (m[1] as string).split(/\r?\n/)) {
    if (/^\s/.test(line)) {
      if (!line.trim() || !last) continue;
      if (last === "metadata") {
        const i = line.indexOf(":");
        if (i > 0)
          metadata[line.slice(0, i).trim()] = unquote(line.slice(i + 1));
      } else {
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
    fields[last] = unquote(line.slice(i + 1));
  }
  const folded = Object.keys(fields).filter(
    (key) => continued.has(key) || /^[>|][+-]?\d*$/.test(fields[key] ?? ""),
  );
  return { fields, metadata, folded, body: m[2] as string };
}

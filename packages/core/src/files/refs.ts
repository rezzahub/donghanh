const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const SKIPPED_SCHEMES = new Set([
  "http",
  "https",
  "mailto",
  "tel",
  "data",
  "javascript",
]);
const LINK = /!?\[[^\]]*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;

/** The scheme of an absolute uri, or null for a relative reference. */
export function uriScheme(uri: string): string | null {
  const match = SCHEME.exec(uri);
  return match ? (match[1] as string).toLowerCase() : null;
}

/** `rel` resolved against the directory of `base` as an encoded URL, fragment kept. */
function resolveEncoded(base: string, rel: string): string {
  const cleanBase = base.replace(/@[^/@]*$/, "");
  let url: URL;
  try {
    url = new URL(cleanBase);
  } catch {
    throw new Error(`Invalid base uri "${base}"`);
  }
  try {
    return new URL(rel, url).href;
  } catch {
    return rel;
  }
}

/**
 * Resolve `rel` against the directory of `base`. An `@version` on the base's
 * last segment is dropped; `../` past the root clamps instead of throwing.
 *
 * The result is the uri in the form providers list it: any `#fragment` is
 * removed and the path is percent-decoded (`my%20notes.md` and `tài-liệu.md`
 * come back with a literal space and literal letters). A path that does not
 * decode stays encoded. `absolutizeRefs` keeps the encoded form instead.
 */
export function resolveRef(base: string, rel: string): string {
  const href = resolveEncoded(base, rel);
  const hash = href.indexOf("#");
  const bare = hash < 0 ? href : href.slice(0, hash);
  try {
    return decodeURI(bare);
  } catch {
    return bare;
  }
}

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

/** Same-length copy of the markdown with code fences and code spans blanked out. */
function maskCode(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: { char: string; len: number } | null = null;
  const masked = lines.map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const closes =
        m &&
        (m[1] as string)[0] === fence.char &&
        (m[1] as string).length >= fence.len &&
        line.trim() === (m[1] as string);
      if (closes) fence = null;
      return blank(line);
    }
    if (m) {
      fence = {
        char: (m[1] as string)[0] as string,
        len: (m[1] as string).length,
      };
      return blank(line);
    }
    return line;
  });
  return masked.join("\n").replace(/(`+)[\s\S]*?\1/g, (span) => blank(span));
}

interface Target {
  start: number;
  end: number;
  raw: string;
}

function scan(markdown: string): Target[] {
  const masked = maskCode(markdown);
  const targets: Target[] = [];
  for (const match of masked.matchAll(LINK)) {
    const raw = match[1] as string;
    const start = match.index + match[0].indexOf("](") + 2;
    targets.push({ start, end: start + raw.length, raw });
  }
  return targets;
}

function isRef(raw: string): boolean {
  if (raw.startsWith("#")) return false;
  const scheme = uriScheme(raw);
  return scheme === null || !SKIPPED_SCHEMES.has(scheme);
}

/** Relative and scheme links in the markdown, deduped by raw target, in order. Code is ignored. */
export function extractRefs(
  markdown: string,
  baseUri: string,
): { raw: string; uri: string }[] {
  const seen = new Set<string>();
  const refs: { raw: string; uri: string }[] = [];
  for (const { raw } of scan(markdown)) {
    if (!isRef(raw) || seen.has(raw)) continue;
    seen.add(raw);
    refs.push({ raw, uri: resolveRef(baseUri, raw) });
  }
  return refs;
}

/**
 * Rewrite relative link targets to absolute uris; every other byte is
 * unchanged. Targets stay percent-encoded and keep their `#fragment`, so the
 * result is still valid Markdown link syntax (unlike `resolveRef`, which
 * decodes and drops the fragment).
 */
export function absolutizeRefs(markdown: string, baseUri: string): string {
  let out = "";
  let cursor = 0;
  for (const { start, end, raw } of scan(markdown)) {
    if (!isRef(raw)) continue;
    out += markdown.slice(cursor, start) + resolveEncoded(baseUri, raw);
    cursor = end;
  }
  return out + markdown.slice(cursor);
}

import { FILE_LIMITS } from "./limits";
import { splitLines } from "./lines";
import { resolveRef, uriScheme } from "./refs";
import { firstFrom } from "./route";
import type { FileContext, FileProvider } from "./types";

export interface ReadArgs {
  uri?: string;
  path?: string;
  base?: string;
  head?: number;
  tail?: number;
  offset?: number;
  limit?: number;
}

export interface ReadResult {
  uri: string;
  version?: string;
  mime: string;
  bytes: number;
  kind: "text" | "binary";
  url?: string;
  text?: string;
  lines?: { from: number; to: number; total: number };
  truncated?: boolean;
  /** True when a line on this page was cut to the line-length cap (so text is not the file verbatim). */
  lineCut?: true;
  next?: { uri: string; offset: number; limit?: number };
}

const MARKER = "…[line truncated]";
const encoder = new TextEncoder();

const count = (n: number): number =>
  Math.min(Math.max(1, Math.floor(n)), FILE_LIMITS.readLines);

function resolveUri(args: ReadArgs): string {
  const { uri, path, base } = args;
  if (uri && path) throw new Error("Pass uri or path, not both.");
  if (uri) return uri;
  if (!path) throw new Error("Pass a uri (or a path with base) to read.");
  if (uriScheme(path)) return path;
  if (!base) {
    throw new Error(
      `Relative path "${path}" needs base — pass the uri of the file that links it (use_skill returns it).`,
    );
  }
  return resolveRef(base, path);
}

function cut(line: string): { line: string; cut: boolean } {
  return line.length > FILE_LIMITS.lineChars
    ? { line: line.slice(0, FILE_LIMITS.lineChars) + MARKER, cut: true }
    : { line, cut: false };
}

/** Keep lines while the joined UTF-8 size stays within the cap; always keep one. */
function fit(lines: string[], fromEnd: boolean): string[] {
  const ordered = fromEnd ? [...lines].reverse() : lines;
  const kept: string[] = [];
  let size = 0;
  for (const line of ordered) {
    const next = size + encoder.encode(line).length + (kept.length ? 1 : 0);
    if (kept.length > 0 && next > FILE_LIMITS.readBytes) break;
    kept.push(line);
    size = next;
  }
  return fromEnd ? kept.reverse() : kept;
}

export async function readFile(
  providers: FileProvider[],
  args: ReadArgs,
  ctx: FileContext,
): Promise<ReadResult> {
  const { head, tail, offset, limit } = args;
  const windowed = offset !== undefined || limit !== undefined;
  const selectors = [head !== undefined, tail !== undefined, windowed];
  if (selectors.filter(Boolean).length > 1) {
    throw new Error(
      "head, tail and offset/limit are mutually exclusive; pass only one.",
    );
  }
  const uri = resolveUri(args);

  let start = 1;
  let size: number = FILE_LIMITS.readLines;
  if (head !== undefined) size = count(head);
  else if (limit !== undefined) size = count(limit);
  if (offset !== undefined) start = Math.max(1, Math.floor(offset));
  const explicit = size !== FILE_LIMITS.readLines;

  let ranged = false;
  const content = await firstFrom(providers, uri, async (p) => {
    if (tail === undefined && p.readLines) {
      const part = await p.readLines(
        uri,
        { from: start, to: start + size - 1 },
        ctx,
      );
      // A slice is only usable with the file's total; otherwise read it whole.
      if (part === null || typeof part.totalLines === "number") {
        ranged = part !== null;
        return part;
      }
    }
    ranged = false;
    return p.read(uri, ctx);
  });
  if (!content) {
    throw new Error(`No file at ${uri}; call list_files to browse.`);
  }

  const base = {
    uri: content.uri,
    ...(content.version ? { version: content.version } : {}),
    mime: content.mime,
    bytes: content.bytes,
  };
  if (content.text === undefined) {
    return {
      ...base,
      kind: "binary",
      ...(content.url ? { url: content.url } : {}),
    };
  }

  const all = splitLines(content.text);
  const total = ranged
    ? (content.totalLines as number)
    : (content.totalLines ?? all.length);

  let chosen: string[];
  let from: number;
  if (tail !== undefined) {
    const n = count(tail);
    chosen = all.slice(Math.max(0, all.length - n));
    from = all.length - chosen.length + 1;
  } else {
    chosen = ranged
      ? all.slice(0, size)
      : all.slice(start - 1, start - 1 + size);
    from = start;
  }
  let anyCut = false;
  const cutLines = chosen.map((l) => {
    const c = cut(l);
    anyCut ||= c.cut;
    return c.line;
  });
  const requested = cutLines.length;
  const out = fit(cutLines, tail !== undefined);
  if (tail !== undefined) from += requested - out.length;
  const fitted = out;

  const to = from + out.length - 1;
  const result: ReadResult = {
    ...base,
    kind: "text",
    text: out.join("\n"),
    lines: { from, to, total },
  };

  let truncated = anyCut || fitted.length < requested;
  if (tail === undefined) {
    if (out.length > 0 && to < total) {
      result.next = {
        uri,
        offset: to + 1,
        ...(explicit ? { limit: size } : {}),
      };
      truncated = true;
    }
  } else if (from > 1 && fitted.length < count(tail)) {
    truncated = true;
  }
  if (truncated) result.truncated = true;
  if (anyCut) result.lineCut = true;
  return result;
}

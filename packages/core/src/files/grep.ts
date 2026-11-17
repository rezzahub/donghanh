import { FILE_LIMITS } from "./limits";
import { splitLines } from "./lines";
import { listFiles } from "./list";
import { firstFrom } from "./route";
import type { FileContext, FileProvider, GrepHit } from "./types";

export interface GrepFilesArgs {
  pattern: string;
  uri: string;
  glob?: string;
  ignoreCase?: boolean;
  context?: number;
  limit?: number;
}

export interface GrepResult {
  hits: GrepHit[];
  capped: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Keep at most `budget` UTF-8 bytes of `text`, cutting on a character
 * boundary and dropping the partial last line.
 */
function withinBudget(
  text: string,
  budget: number,
): { text: string; bytes: number; truncated: boolean } {
  const buf = encoder.encode(text);
  if (buf.length <= budget) {
    return { text, bytes: buf.length, truncated: false };
  }
  let end = budget;
  while (end > 0 && ((buf[end] as number) & 0xc0) === 0x80) end--;
  const kept = decoder.decode(buf.subarray(0, end));
  const lastNewline = kept.lastIndexOf("\n");
  return {
    text: lastNewline < 0 ? "" : kept.slice(0, lastNewline + 1),
    bytes: end,
    truncated: true,
  };
}
const PAGE = 500;
// listFiles clamps depth only from below, so this is effectively unlimited.
const DEPTH = 1_000_000;

const cutLine = (line: string): string => line.slice(0, FILE_LIMITS.lineChars);

/** Collect up to `max` file uris under a folder, paging through list. */
async function collectFiles(
  providers: FileProvider[],
  uri: string,
  glob: string | undefined,
  max: number,
  ctx: FileContext,
): Promise<{ files: string[]; capped: boolean }> {
  const files: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listFiles(
      providers,
      { uri, depth: DEPTH, glob, limit: PAGE, after },
      ctx,
    );
    for (const e of page.entries) {
      if (e.kind !== "file") continue;
      if (files.length >= max) return { files, capped: true };
      files.push(e.uri);
    }
    if (!page.next) return { files, capped: false };
    if (files.length >= max) return { files, capped: true };
    after = page.next;
  }
}

export async function grepFiles(
  providers: FileProvider[],
  args: GrepFilesArgs,
  ctx: FileContext,
): Promise<GrepResult> {
  const { uri } = args;
  let re: RegExp;
  try {
    re = new RegExp(args.pattern, args.ignoreCase ? "i" : "");
  } catch {
    throw new Error(
      `Invalid pattern ${JSON.stringify(args.pattern)}; pass a JavaScript regular expression.`,
    );
  }
  const context = Math.min(
    Math.max(0, Math.floor(args.context ?? FILE_LIMITS.grepContext)),
    FILE_LIMITS.grepContext,
  );
  const limit = Math.min(
    Math.max(1, Math.floor(args.limit ?? FILE_LIMITS.grepMatches)),
    FILE_LIMITS.grepMatches,
  );

  // A native grep that fails falls back to the scan below, which reports
  // unavailable itself if the providers cannot list or read either.
  const native = await firstFrom(providers, uri, async (p) =>
    p.grep
      ? p.grep(
          {
            uri,
            pattern: args.pattern,
            glob: args.glob,
            ignoreCase: args.ignoreCase,
            context,
            limit,
          },
          ctx,
        )
      : null,
  ).catch(() => null);
  if (native) {
    return { hits: native.slice(0, limit), capped: native.length >= limit };
  }

  const entry = await firstFrom(providers, uri, (p) => p.stat(uri, ctx));
  if (!entry) {
    throw new Error(
      `No file or folder at ${uri}; call list_files with no uri to see the roots.`,
    );
  }
  let files: string[];
  let capped = false;
  if (entry.kind === "file") {
    files = [uri];
  } else {
    const walk = await collectFiles(
      providers,
      uri,
      args.glob,
      FILE_LIMITS.grepFiles,
      ctx,
    );
    files = walk.files;
    capped = walk.capped;
  }

  const hits: GrepHit[] = [];
  let bytes = 0;
  for (let i = 0; i < files.length; i++) {
    if (bytes >= FILE_LIMITS.grepBytes) return { hits, capped: true };
    const file = files[i] as string;
    const content = await firstFrom(providers, file, (p) => p.read(file, ctx));
    if (!content || content.url || content.text === undefined) continue;
    const fit = withinBudget(content.text, FILE_LIMITS.grepBytes - bytes);
    bytes += fit.bytes;
    if (fit.truncated) capped = true;
    const lines = splitLines(fit.text).map(cutLine);
    for (let n = 0; n < lines.length; n++) {
      if (!re.test(lines[n] as string)) continue;
      if (hits.length >= limit) return { hits, capped: true };
      hits.push({
        uri: content.uri,
        line: n + 1,
        text: lines[n] as string,
        before: lines.slice(Math.max(0, n - context), n),
        after: lines.slice(n + 1, n + 1 + context),
      });
    }
    if (fit.truncated) return { hits, capped: true };
  }
  return { hits, capped };
}

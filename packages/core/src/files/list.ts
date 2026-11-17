import { FILE_LIMITS } from "./limits";
import { firstFrom } from "./route";
import type { FileContext, FileEntry, FileProvider, ListResult } from "./types";

export interface ListArgs {
  uri?: string;
  depth?: number;
  glob?: string;
  limit?: number;
  after?: string;
}

async function listRoots(
  providers: FileProvider[],
  ctx: FileContext,
): Promise<ListResult> {
  const entries = new Map<string, FileEntry>();
  const failed: string[] = [];
  let answered = 0;
  for (const p of providers) {
    if (!p.roots) continue;
    try {
      for (const e of await p.roots(ctx)) entries.set(e.uri, e);
      answered++;
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      console.error(`[files] provider ${p.scheme} failed (${name})`);
      failed.push(p.scheme);
    }
  }
  if (answered === 0 && failed.length > 0) {
    throw new Error(
      `File providers are unavailable (${[...new Set(failed)].join(", ")}); try again.`,
    );
  }
  return { entries: [...entries.values()] };
}

export async function listFiles(
  providers: FileProvider[],
  args: ListArgs,
  ctx: FileContext,
): Promise<ListResult> {
  const { uri } = args;
  if (!uri) return listRoots(providers, ctx);
  const limit = Math.min(
    Math.max(1, Math.floor(args.limit ?? FILE_LIMITS.listDefault)),
    FILE_LIMITS.listMax,
  );
  const depth = Math.max(1, Math.floor(args.depth ?? 1));
  const result = await firstFrom(providers, uri, async (p) =>
    (await p.stat(uri, ctx))
      ? p.list(uri, { depth, glob: args.glob, limit, after: args.after }, ctx)
      : null,
  );
  if (!result) {
    throw new Error(
      `No file or folder at ${uri}; call list_files with no uri to see the roots.`,
    );
  }
  return result;
}

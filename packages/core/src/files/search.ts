import { FILE_LIMITS } from "./limits";
import type { FileContext, FileProvider, SearchHit } from "./types";

export interface SearchArgs {
  query: string;
  uri?: string;
  limit?: number;
}

export interface SearchResult {
  hits: SearchHit[];
}

export async function searchFiles(
  providers: FileProvider[],
  args: SearchArgs,
  ctx: FileContext,
): Promise<SearchResult> {
  const searchable = providers.filter((p) => p.search);
  if (searchable.length === 0) {
    throw new Error("Search is not available for these files; use grep_files.");
  }
  const limit = Math.min(
    Math.max(1, Math.floor(args.limit ?? FILE_LIMITS.searchDefault)),
    FILE_LIMITS.searchMax,
  );
  const hits: SearchHit[] = [];
  for (const p of searchable) {
    try {
      hits.push(
        ...(await (p.search as NonNullable<FileProvider["search"]>)(
          args.query,
          { uri: args.uri, limit },
          ctx,
        )),
      );
    } catch (e) {
      const name = e instanceof Error ? e.name : "Error";
      console.error(`[files] provider ${p.scheme} failed (${name})`);
    }
  }
  return { hits: hits.slice(0, limit) };
}

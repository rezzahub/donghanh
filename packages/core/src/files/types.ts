import type { ExecutorContext } from "../types";

export interface FileEntry {
  uri: string;
  kind: "file" | "dir";
  bytes?: number;
  lines?: number;
  mime?: string;
  description?: string;
  version?: string;
}

export interface FileContent {
  uri: string;
  version?: string;
  mime: string;
  bytes: number;
  text?: string;
  url?: string;
  totalLines?: number;
}

export type FileContext = ExecutorContext;

export interface ListOptions {
  depth: number;
  glob?: string;
  limit: number;
  after?: string;
}

export interface ListResult {
  entries: FileEntry[];
  next?: string;
}

export interface GrepArgs {
  uri: string;
  pattern: string;
  glob?: string;
  ignoreCase?: boolean;
  context: number;
  limit: number;
}

export interface GrepHit {
  uri: string;
  line: number;
  text: string;
  before: string[];
  after: string[];
}

export interface SearchHit {
  uri: string;
  version?: string;
  lines: [number, number];
  snippet: string;
  score: number;
}

export interface FileProvider {
  scheme: string;
  roots?(ctx: FileContext): Promise<FileEntry[]>;
  stat(uri: string, ctx: FileContext): Promise<FileEntry | null>;
  list(uri: string, o: ListOptions, ctx: FileContext): Promise<ListResult>;
  read(uri: string, ctx: FileContext): Promise<FileContent | null>;
  readLines?(
    uri: string,
    range: { from: number; to: number },
    ctx: FileContext,
  ): Promise<FileContent | null>;
  grep?(args: GrepArgs, ctx: FileContext): Promise<GrepHit[]>;
  search?(
    query: string,
    o: { uri?: string; limit: number },
    ctx: FileContext,
  ): Promise<SearchHit[]>;
}

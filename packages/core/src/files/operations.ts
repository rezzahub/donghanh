import { textBrief } from "../brief";
import type { Executor, OperationComponent } from "../types";
import { registerOperation } from "../types";
import { grepFiles } from "./grep";
import { FILE_LIMITS } from "./limits";
import { listFiles } from "./list";
import { readFile } from "./read";
import { searchFiles } from "./search";
import type { FileContext, FileProvider } from "./types";

export const FILES_INSTRUCTIONS =
  "Skills and docs are file trees addressed by URI (scheme://path). " +
  "Relative paths inside a document resolve against the document (file) they appear in, so pass that file's uri as base with the relative path. " +
  "Start from list_files with no uri to see what is mounted, then read_file to open files; reads are paged, so follow next when a result is truncated.";

type Handler = (
  vars: Record<string, unknown>,
  ctx: FileContext,
) => Promise<unknown>;

function int(vars: Record<string, unknown>, name: string) {
  const v = vars[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new Error(`${name} must be an integer`);
  }
  return v;
}

function str(vars: Record<string, unknown>, name: string) {
  const v = vars[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`${name} must be a string`);
  return v;
}

function bool(vars: Record<string, unknown>, name: string) {
  const v = vars[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw new Error(`${name} must be a boolean`);
  return v;
}

/** Drop undefined values so engine defaults apply. */
function defined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as T;
}

export function fileOperations(opts: {
  providers: FileProvider[];
  prefix?: string;
  auth?: "none" | "optional" | "required";
}): {
  operations: Record<string, OperationComponent>;
  wrap(executor: Executor): Executor;
  instructions: string;
} {
  const { providers } = opts;
  const prefix = opts.prefix ?? "";
  const searchable = providers.some((p) => p.search);
  const list = `${prefix}list_files`;
  const read = `${prefix}read_file`;
  const grep = `${prefix}grep_files`;
  const search = `${prefix}search_files`;
  // Name search_files only when it is registered.
  const finders = searchable ? `${grep} or ${search}` : grep;

  const handlers: Record<string, Handler> = {
    async list_files(vars, ctx) {
      return listFiles(
        providers,
        defined({
          uri: str(vars, "uri"),
          depth: int(vars, "depth"),
          glob: str(vars, "glob"),
          limit: int(vars, "limit"),
          after: str(vars, "after"),
        }),
        ctx,
      );
    },
    async read_file(vars, ctx) {
      return readFile(
        providers,
        defined({
          uri: str(vars, "uri"),
          path: str(vars, "path"),
          base: str(vars, "base"),
          head: int(vars, "head"),
          tail: int(vars, "tail"),
          offset: int(vars, "offset"),
          limit: int(vars, "limit"),
        }),
        ctx,
      );
    },
    async grep_files(vars, ctx) {
      const pattern = str(vars, "pattern");
      const uri = str(vars, "uri");
      if (!pattern) throw new Error("pattern is required");
      if (!uri) throw new Error("uri is required");
      return grepFiles(
        providers,
        defined({
          pattern,
          uri,
          glob: str(vars, "glob"),
          ignoreCase: bool(vars, "ignoreCase"),
          context: int(vars, "context"),
          limit: int(vars, "limit"),
        }),
        ctx,
      );
    },
    async search_files(vars, ctx) {
      const query = str(vars, "query");
      if (!query) throw new Error("query is required");
      return searchFiles(
        providers,
        defined({
          query,
          uri: str(vars, "uri"),
          limit: int(vars, "limit"),
        }),
        ctx,
      );
    },
  };

  const operations: Record<string, OperationComponent> = {};
  const define = (
    name: string,
    component: Parameters<typeof registerOperation>[0],
    config: Omit<Parameters<typeof registerOperation>[1], "id" | "auth">,
  ) => {
    const id = prefix + name;
    operations[id] = registerOperation(component, {
      ...config,
      id,
      ...(opts.auth ? { auth: opts.auth } : {}),
    });
  };

  define(
    "list_files",
    ({ data }) => {
      const d = data as {
        entries: {
          uri: string;
          kind: string;
          bytes?: number;
          lines?: number;
          description?: string;
        }[];
        next?: string;
      };
      const lines = d.entries.map((e) =>
        [
          e.uri + (e.kind === "dir" && !e.uri.endsWith("/") ? "/" : ""),
          e.bytes !== undefined ? `${e.bytes}B` : "",
          e.lines !== undefined ? `${e.lines} lines` : "",
          e.description ?? "",
        ]
          .filter(Boolean)
          .join("  "),
      );
      if (!lines.length) lines.push("No files found.");
      if (d.next) {
        lines.push(`More: call ${list} again with after: ${d.next}`);
      }
      return textBrief(lines.join("\n"));
    },
    {
      type: "query",
      title: "List files",
      description: "List files and folders in the mounted file trees.",
      instruction: `Start with no uri to see the mounted roots, then pass a folder uri. Entries show size, line count and a description so you can choose without reading. depth goes deeper, glob filters paths. When the result names a next cursor, pass it as after to continue. Use ${finders} to find content before reading large files.`,
      input: {
        type: "object",
        properties: {
          uri: {
            type: "string",
            description: "Folder uri; omit to list the roots",
          },
          depth: {
            type: "integer",
            minimum: 1,
            description: "Levels to descend (default 1)",
          },
          glob: { type: "string", description: "Filter paths, e.g. **/*.md" },
          limit: {
            type: "integer",
            minimum: 1,
            description: "Max entries per page",
          },
          after: {
            type: "string",
            description: "Cursor from a previous result",
          },
        },
      },
      responseKey: "files",
      idempotent: true,
    },
  );

  define(
    "read_file",
    ({ data }) => {
      const d = data as {
        uri: string;
        mime: string;
        bytes: number;
        kind: "text" | "binary";
        url?: string;
        text?: string;
        lines?: { from: number; to: number; total: number };
        truncated?: boolean;
        next?: { uri: string; offset: number; limit?: number };
      };
      if (d.kind === "binary") {
        return textBrief(
          `${d.uri} is binary (${d.mime}, ${d.bytes} bytes); no content shown.${d.url ? `\nurl: ${d.url}` : ""}`,
        );
      }
      const from = d.lines?.from ?? 1;
      const to = d.lines?.to ?? 0;
      const total = d.lines?.total ?? 0;
      if (from > total || to < from) {
        return textBrief(
          `${d.uri} has no lines in this range (past the end; the file has ${total} lines).`,
        );
      }
      const out = (d.text ?? "").split("\n").map((t, i) => `${from + i}\t${t}`);
      if (d.next) {
        out.push(
          `[truncated: lines ${from}-${to} of ${total}. Continue with ${read} uri: ${d.next.uri}, offset: ${d.next.offset}${d.next.limit !== undefined ? `, limit: ${d.next.limit}` : ""}]`,
        );
      } else if (d.truncated && from > 1) {
        const offset = Math.max(1, from - FILE_LIMITS.readLines);
        out.push(
          `[truncated: lines ${from}-${to} of ${total}. Earlier lines: ${read} uri: ${d.uri}, offset: ${offset}, limit: ${Math.min(FILE_LIMITS.readLines, from - 1)}]`,
        );
      } else if (d.truncated) {
        out.push(
          `[truncated: lines ${from}-${to} of ${total}; long lines were cut]`,
        );
      }
      return textBrief(out.join("\n"));
    },
    {
      type: "query",
      title: "Read file",
      description: "Read a text file by uri, one page at a time.",
      instruction: `Pass uri, or a relative path together with base (the uri of the file that links it); relative paths without base fail. Reads are paged: the first 200 lines by default. When the result is truncated, call again with the exact next arguments it shows. Use head for the first n lines, tail for the last n, or offset and limit for a window; pass only one of these. Before reading a large file, find the part you need with ${finders}. Binary files return their type, size and a url, never content.`,
      input: {
        type: "object",
        properties: {
          uri: { type: "string", description: "File uri" },
          path: {
            type: "string",
            description: "Relative path; needs base",
          },
          base: {
            type: "string",
            description: "Uri of the file that contains the relative path",
          },
          head: {
            type: "integer",
            minimum: 1,
            description: "First n lines",
          },
          tail: {
            type: "integer",
            minimum: 1,
            description: "Last n lines",
          },
          offset: {
            type: "integer",
            minimum: 1,
            description: "1-based first line to read",
          },
          limit: {
            type: "integer",
            minimum: 1,
            description: "Lines to read from offset",
          },
        },
      },
      responseKey: "file",
      idempotent: true,
    },
  );

  define(
    "grep_files",
    ({ data }) => {
      const d = data as {
        hits: {
          uri: string;
          line: number;
          text: string;
          before: string[];
          after: string[];
        }[];
        capped: boolean;
      };
      const out: string[] = [];
      for (const h of d.hits) {
        h.before.forEach((t, i) => {
          out.push(`${h.uri}-${h.line - h.before.length + i}- ${t}`);
        });
        out.push(`${h.uri}:${h.line}: ${h.text}`);
        h.after.forEach((t, i) => {
          out.push(`${h.uri}-${h.line + 1 + i}- ${t}`);
        });
      }
      if (!d.hits.length) out.push("No matches.");
      if (d.capped) {
        out.push(
          "[results capped: narrow the pattern, uri or glob to see more]",
        );
      }
      return textBrief(out.join("\n"));
    },
    {
      type: "query",
      title: "Grep files",
      description: "Find exact text or a regular expression in files.",
      instruction: `Pass pattern (a JavaScript regular expression) and the uri of a file or folder to search. Use it for exact strings and names, and before reading a large file; then ${read} with offset near the line shown. glob narrows paths, context adds surrounding lines. Results are capped; narrow the search if capped.`,
      input: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "JavaScript regular expression",
          },
          uri: { type: "string", description: "File or folder uri" },
          glob: { type: "string", description: "Filter paths" },
          ignoreCase: { type: "boolean" },
          context: {
            type: "integer",
            minimum: 0,
            description: "Lines of context around each match",
          },
          limit: {
            type: "integer",
            minimum: 1,
            description: "Max matches",
          },
        },
        required: ["pattern", "uri"],
      },
      responseKey: "matches",
      idempotent: true,
    },
  );

  if (searchable) {
    define(
      "search_files",
      ({ data }) => {
        const d = data as {
          hits: {
            uri: string;
            lines: [number, number];
            snippet: string;
            score: number;
          }[];
        };
        const out = d.hits.map(
          (h) =>
            `${h.uri}:${h.lines[0]}-${h.lines[1]} (score ${h.score.toFixed(2)}) ${h.snippet}`,
        );
        if (!out.length) return textBrief("No results.");
        out.push(
          `Open a hit with ${read} uri and offset set to its first line.`,
        );
        return textBrief(out.join("\n"));
      },
      {
        type: "query",
        title: "Search files",
        description: "Find files by meaning rather than exact text.",
        instruction: `Pass a natural-language query, optionally a uri to search under. Use it for concepts and before reading a large file; use ${grep} for exact strings. Each hit gives a uri and a line range: open it with ${read} using offset.`,
        input: {
          type: "object",
          properties: {
            query: { type: "string", description: "What to look for" },
            uri: { type: "string", description: "Limit to this uri" },
            limit: {
              type: "integer",
              minimum: 1,
              description: "Max hits",
            },
          },
          required: ["query"],
        },
        responseKey: "hits",
        idempotent: true,
      },
    );
  }

  return {
    operations,
    instructions: FILES_INSTRUCTIONS,
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

import { globToRegExp } from "./glob";
import { splitLines } from "./lines";
import { describeMarkdown } from "./markdown";
import { uriScheme } from "./refs";
import type {
  FileContent,
  FileEntry,
  FileProvider,
  ListOptions,
  ListResult,
} from "./types";

export type StaticBinary = { url: string; mime: string; bytes: number };

const MIMES: Record<string, string> = {
  md: "text/markdown",
  json: "application/json",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

function mimeOf(path: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  return (m && MIMES[(m[1] as string).toLowerCase()]) || "text/plain";
}

const encoder = new TextEncoder();

/** An in-memory provider; a tree key is the path after `scheme://`. */
export function staticFiles(
  scheme: string,
  tree: Record<string, string | StaticBinary>,
): FileProvider {
  const prefix = `${scheme}://`;
  const paths = Object.keys(tree).sort();

  const pathOf = (uri: string): string | null =>
    uriScheme(uri) === scheme && uri.toLowerCase().startsWith(prefix)
      ? uri.slice(prefix.length)
      : null;

  const fileEntry = (path: string): FileEntry => {
    const value = tree[path] as string | StaticBinary;
    const uri = prefix + path;
    if (typeof value !== "string") {
      return { uri, kind: "file", bytes: value.bytes, mime: value.mime };
    }
    const mime = mimeOf(path);
    const entry: FileEntry = {
      uri,
      kind: "file",
      bytes: encoder.encode(value).length,
      lines: splitLines(value).length,
      mime,
    };
    if (mime === "text/markdown") entry.description = describeMarkdown(value);
    return entry;
  };

  const dirPrefixOf = (path: string): string | null => {
    const dir = path === "" || path.endsWith("/") ? path : `${path}/`;
    return paths.some((k) => k.startsWith(dir)) ? dir : null;
  };

  const stat = async (uri: string): Promise<FileEntry | null> => {
    const path = pathOf(uri);
    if (path === null) return null;
    if (path !== "" && !path.endsWith("/") && path in tree) {
      return fileEntry(path);
    }
    const dir = dirPrefixOf(path);
    return dir === null ? null : { uri: prefix + dir, kind: "dir" };
  };

  const list = async (uri: string, o: ListOptions): Promise<ListResult> => {
    const path = pathOf(uri);
    if (path === null) return { entries: [] };
    if (path !== "" && !path.endsWith("/") && path in tree) {
      return { entries: [fileEntry(path)] };
    }
    const dir = dirPrefixOf(path);
    if (dir === null) return { entries: [] };
    const re = o.glob ? globToRegExp(o.glob) : null;
    const found = new Map<string, FileEntry>();
    for (const key of paths) {
      if (!key.startsWith(dir)) continue;
      const segs = key.slice(dir.length).split("/");
      const max = Math.min(o.depth, segs.length);
      for (let i = 1; i <= max; i++) {
        if (i === segs.length) {
          if (!re || re.test(segs.join("/"))) {
            found.set(prefix + key, fileEntry(key));
          }
        } else if (!re) {
          const uriDir = `${prefix}${dir}${segs.slice(0, i).join("/")}/`;
          found.set(uriDir, { uri: uriDir, kind: "dir" });
        }
      }
    }
    let entries = [...found.values()].sort((x, y) =>
      x.uri < y.uri ? -1 : x.uri > y.uri ? 1 : 0,
    );
    const after = o.after;
    if (after !== undefined) entries = entries.filter((e) => e.uri > after);
    if (entries.length <= o.limit) return { entries };
    const page = entries.slice(0, o.limit);
    return { entries: page, next: (page[page.length - 1] as FileEntry).uri };
  };

  const read = async (uri: string): Promise<FileContent | null> => {
    const path = pathOf(uri);
    if (path === null || path === "" || path.endsWith("/") || !(path in tree)) {
      return null;
    }
    const value = tree[path] as string | StaticBinary;
    if (typeof value !== "string") {
      return {
        uri: prefix + path,
        mime: value.mime,
        bytes: value.bytes,
        url: value.url,
      };
    }
    return {
      uri: prefix + path,
      mime: mimeOf(path),
      bytes: encoder.encode(value).length,
      text: value,
      totalLines: splitLines(value).length,
    };
  };

  return {
    scheme,
    roots: async () => {
      const firsts = [...new Set(paths.map((k) => k.split("/")[0] as string))];
      return firsts.map((f) => ({
        uri: `${prefix}${f}/`,
        kind: "dir" as const,
      }));
    },
    stat,
    list,
    read,
  };
}

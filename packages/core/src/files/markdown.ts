import { parseFrontmatter } from "./frontmatter";
import { splitLines } from "./lines";

export interface MarkdownChunk {
  from: number;
  to: number;
  text: string;
}

const DESCRIPTION_CHARS = 160;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** For each line, whether it starts a heading outside a fenced code block. */
function headingLines(lines: string[]): boolean[] {
  let fence: { char: string; len: number } | null = null;
  return lines.map((line) => {
    const m = FENCE.exec(line);
    if (fence) {
      const run = m?.[1] as string | undefined;
      if (
        run &&
        run[0] === fence.char &&
        run.length >= fence.len &&
        line.trim() === run
      ) {
        fence = null;
      }
      return false;
    }
    if (m) {
      fence = {
        char: (m[1] as string)[0] as string,
        len: (m[1] as string).length,
      };
      return false;
    }
    return HEADING.test(line);
  });
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > DESCRIPTION_CHARS
    ? flat.slice(0, DESCRIPTION_CHARS)
    : flat;
}

/** Heading text without the opening `#`s or a closing `#` sequence. */
const headingText = (line: string): string =>
  line
    .replace(/^ {0,3}#{1,6}/, "")
    .replace(/(?:^|\s)#+\s*$/, "")
    .trim();

/** One-line description: frontmatter description, else first heading (any level), else first non-empty line. */
export function describeMarkdown(text: string): string {
  const fm = parseFrontmatter(text);
  const description = fm?.folded.includes("description")
    ? undefined
    : fm?.fields.description;
  if (description) return oneLine(description);
  const lines = (fm ? fm.body : text).split(/\r?\n/);
  const heads = headingLines(lines);
  for (let i = 0; i < lines.length; i++) {
    const text = heads[i] ? headingText(lines[i] as string) : "";
    if (text) return oneLine(text);
  }
  const first = lines.find((l) => l.trim());
  return first ? oneLine(first) : "";
}

/** Contiguous chunks covering every line; `from`/`to` are 1-based inclusive. */
export function chunkMarkdown(
  text: string,
  opts: { by: "heading" | "lines"; size?: number },
): MarkdownChunk[] {
  // Same line rule as read_file: no phantom line after a trailing newline.
  const lines = splitLines(text);
  if (!lines.length) return [];
  const starts: number[] = [0];
  if (opts.by === "lines") {
    const size = Math.max(1, Math.floor(opts.size ?? 40));
    for (let i = size; i < lines.length; i += size) starts.push(i);
  } else {
    headingLines(lines).forEach((isHeading, i) => {
      if (isHeading && i > 0) starts.push(i);
    });
  }
  return starts.map((start, n) => {
    const end = (starts[n + 1] ?? lines.length) - 1;
    return {
      from: start + 1,
      to: end + 1,
      text: lines.slice(start, end + 1).join("\n"),
    };
  });
}

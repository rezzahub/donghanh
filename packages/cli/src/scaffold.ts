import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function kebabToPascal(name: string): string {
  return name
    .split(/[-_]/g)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join("");
}

function kebabToCamel(name: string): string {
  const pascal = kebabToPascal(name);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

export function widgetTemplate(name: string): string {
  return `import { createRoot } from "react-dom/client";
import { DongHanhWidget } from "@donghanh/widget";

const root = document.getElementById("root");
if (root) createRoot(root).render(<DongHanhWidget appName="${name}" />);
`;
}

export function operationTemplate(
  name: string,
  type: "query" | "mutation",
): string {
  const component = kebabToPascal(name);
  const responseKey = kebabToCamel(name);
  return `/** @jsxImportSource @donghanh/core */
import { Brief, Display, registerOperation } from "@donghanh/core";
import type { OperationProps } from "@donghanh/core";

interface Data {
  // TODO: type your data shape
}

function ${component}({ data }: OperationProps<Data>) {
  return (
    <Brief>
      <Display data={data} />
    </Brief>
  );
}

export default registerOperation(${component}, {
  id: "${name}",
  type: "${type}",
  description: "TODO: one-line action description",
  instruction: "TODO: call-time guidance",
  input: {},
  responseKey: "${responseKey}",
});
`;
}

export async function writeFileSafe(
  path: string,
  contents: string,
): Promise<"written" | "exists"> {
  if (existsSync(path)) return "exists";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return "written";
}

/**
 * Patch `donghanh.config.ts` in place to add a `widgets: { [name]: path }`
 * entry. Textual edit — works for common formats, falls back to printing a
 * snippet when it can't find the widgets block.
 */
export async function patchConfigWidget(
  configPath: string,
  name: string,
  entry: string,
): Promise<"patched" | "manual"> {
  if (!existsSync(configPath)) return "manual";
  const src = await readFile(configPath, "utf8");
  if (src.includes(`"${name}"`)) return "patched"; // already present

  const widgetsRegex = /widgets\s*:\s*\{([\s\S]*?)\}/m;
  const match = src.match(widgetsRegex);
  if (!match) return "manual";

  const inside = match[1];
  const insertion = `\n    ${name}: "${entry}",`;
  const nextInside = inside.trimEnd() + insertion + "\n  ";
  const next = src.replace(widgetsRegex, `widgets: {${nextInside}}`);
  await writeFile(configPath, next, "utf8");
  return "patched";
}

export function configSnippet(name: string, entry: string): string {
  return `  widgets: {\n    ${name}: "${entry}",\n  }`;
}

export const paths = {
  widget: (name: string) => `widgets/${name}.tsx`,
  operation: (name: string) => `operations/${name}.tsx`,
};

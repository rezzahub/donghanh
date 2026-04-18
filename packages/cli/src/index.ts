import { dirname } from "node:path";
import { findConfig } from "@donghanh/config";
import {
  configSnippet,
  operationTemplate,
  patchConfigWidget,
  paths,
  widgetTemplate,
  writeFileSafe,
} from "./scaffold";

export interface RunResult {
  code: number;
  messages: string[];
}

export interface RunOptions {
  /** Working directory used to locate `donghanh.config.ts`. Defaults to `process.cwd()`. */
  cwd?: string;
}

const HELP = `donghanh — scaffold operations, widgets, and patch donghanh.config.ts

Usage:
  donghanh widget <name>                 Create widgets/<name>.tsx and patch config
  donghanh operation <name> [--mutation] Create operations/<name>.tsx (query by default)
  donghanh build                         Build widgets via Vite (reads donghanh.config.ts)
  donghanh dev                           Build widgets in watch mode (run your server separately)
  donghanh help

Flags:
  --mutation    Scaffold as type: "mutation" instead of "query"
`;

const CONFIG_MISSING_HINT = [
  "donghanh.config.ts not found. Create one at project root:",
  "",
  '  import { defineConfig } from "@donghanh/config";',
  "",
  "  export default defineConfig({",
  '    operations: "./operations/**/*.tsx",',
  "    widgets: {",
  '      // "my-widget": "./widgets/my-widget.tsx",',
  "    },",
  "  });",
];

export async function run(
  argv: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const messages: string[] = [];
  const out = (msg: string) => messages.push(msg);
  const cwd = opts.cwd ?? process.cwd();

  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    out(HELP);
    return { code: 0, messages };
  }

  if (cmd === "widget") {
    const name = rest[0];
    if (!name) {
      out("Missing <name>. Usage: donghanh widget <name>");
      return { code: 1, messages };
    }
    const file = paths.widget(name);
    const status = await writeFileSafe(file, widgetTemplate(name));
    out(status === "exists" ? `• exists ${file}` : `✓ wrote ${file}`);

    const configPath = findConfig(cwd);
    if (!configPath) {
      out("! donghanh.config.ts not found — add:");
      out(configSnippet(name, `./${file}`));
      return { code: 0, messages };
    }
    const entry = `./${file}`;
    const patch = await patchConfigWidget(configPath, name, entry);
    if (patch === "patched") {
      out(`✓ patched ${configPath}`);
    } else {
      out(`! could not patch ${configPath} automatically — add:`);
      out(configSnippet(name, entry));
    }
    return { code: 0, messages };
  }

  if (cmd === "operation" || cmd === "op") {
    const name = rest[0];
    const isMutation = rest.includes("--mutation") || rest.includes("-m");
    if (!name) {
      out("Missing <name>. Usage: donghanh operation <name> [--mutation]");
      return { code: 1, messages };
    }
    const file = paths.operation(name);
    const status = await writeFileSafe(
      file,
      operationTemplate(name, isMutation ? "mutation" : "query"),
    );
    out(status === "exists" ? `• exists ${file}` : `✓ wrote ${file}`);
    out(
      "! Register the operation in your operations index (operations/index.ts).",
    );
    return { code: 0, messages };
  }

  if (cmd === "build" || cmd === "dev") {
    const isDev = cmd === "dev";
    const configPath = findConfig(cwd);
    if (!configPath) {
      for (const line of CONFIG_MISSING_HINT) out(line);
      return { code: 1, messages };
    }
    const root = dirname(configPath);
    if (isDev) {
      out(
        "Building widgets in watch mode. Run your server (wrangler dev / bun run dev) in a separate terminal.",
      );
    }
    const args = isDev
      ? ["x", "vite", "build", "--watch"]
      : ["x", "vite", "build"];
    const proc = Bun.spawn(["bun", ...args], {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    return { code, messages };
  }

  out(`Unknown command: ${cmd}\n\n${HELP}`);
  return { code: 1, messages };
}

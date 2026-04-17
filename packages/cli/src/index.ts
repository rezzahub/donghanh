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

const HELP = `donghanh — scaffold operations, widgets, and patch donghanh.config.ts

Usage:
  donghanh widget <name>                 Create widgets/<name>.tsx and patch config
  donghanh operation <name> [--mutation] Create operations/<name>.tsx (query by default)
  donghanh help

Flags:
  --mutation    Scaffold as type: "mutation" instead of "query"
`;

export async function run(argv: string[]): Promise<RunResult> {
  const messages: string[] = [];
  const out = (msg: string) => messages.push(msg);

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

    const configPath = findConfig();
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

  out(`Unknown command: ${cmd}\n\n${HELP}`);
  return { code: 1, messages };
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const TEMPLATES = ["minimal", "trello"] as const;
type Template = (typeof TEMPLATES)[number];

const DESCRIPTIONS: Record<Template, string> = {
  minimal: "Hello world with D1 SQLite — 2 operations",
  trello: "Mini Trello with boards, cards, members — 6 operations",
};

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function copyDir(src: string, dest: string, replacements: [string, string][]) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, replacements);
    } else {
      let content = fs.readFileSync(srcPath, "utf-8");
      for (const [from, to] of replacements) {
        content = content.replaceAll(from, to);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let target = args[0];
  let template: Template | undefined;

  // Parse --template / -t flag
  const tIdx = args.indexOf("--template");
  const tShortIdx = args.indexOf("-t");
  const flagIdx = tIdx !== -1 ? tIdx : tShortIdx;
  if (flagIdx !== -1 && args[flagIdx + 1]) {
    template = args[flagIdx + 1] as Template;
    // Remove flag and value from args
    if (!target || target.startsWith("-")) {
      target = undefined;
    }
  }

  console.log();
  console.log("  \x1b[1m@donghanh\x1b[0m — Conversational UI Framework");
  console.log();

  // Prompt for target if not given
  if (!target || target.startsWith("-")) {
    target = await prompt("  Project name: ");
    if (!target) {
      console.log("  Cancelled.");
      process.exit(0);
    }
  }

  // Prompt for template if not given
  if (!template || !TEMPLATES.includes(template)) {
    console.log();
    console.log("  Templates:");
    for (let i = 0; i < TEMPLATES.length; i++) {
      console.log(
        `    \x1b[1m${i + 1}\x1b[0m) ${TEMPLATES[i]} — ${DESCRIPTIONS[TEMPLATES[i]]}`,
      );
    }
    console.log();
    const choice = await prompt("  Select template (1-2): ");
    const idx = Number.parseInt(choice, 10) - 1;
    template = TEMPLATES[idx] ?? "minimal";
  }

  const destDir = path.resolve(target);
  if (fs.existsSync(destDir)) {
    console.log(
      `  \x1b[31mError:\x1b[0m Directory "${target}" already exists.`,
    );
    process.exit(1);
  }

  // Find templates directory
  const templatesDir = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "templates",
  );
  const srcDir = path.join(templatesDir, template);

  if (!fs.existsSync(srcDir)) {
    console.log(`  \x1b[31mError:\x1b[0m Template "${template}" not found.`);
    process.exit(1);
  }

  // Copy template with name replacement
  const appName = path.basename(target);
  copyDir(srcDir, destDir, [
    ["my-donghanh-app", appName],
    ["my-trello-app", appName],
    ["my-donghanh-app-db", `${appName}-db`],
    ["my-trello-db", `${appName}-db`],
  ]);

  console.log();
  console.log(
    `  \x1b[32m✓\x1b[0m Created \x1b[1m${appName}\x1b[0m from \x1b[1m${template}\x1b[0m template`,
  );
  console.log();
  console.log("  Next steps:");
  console.log(`    cd ${target}`);
  console.log("    bun install");
  console.log("    bun run db:init     # initialize D1 database");
  console.log("    bun run dev         # start dev server");
  console.log();
}

main().catch(console.error);

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface CspConfig {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
}

export interface ServerConfig {
  /** Canonical HTTPS identifier for this MCP server. */
  resource?: string;
  /** OAuth authorization server issuer URLs. */
  authorizationServers?: string[];
  /** Default scopes. */
  scopes?: string[];
  /** Widget sandbox domain (required for Apps SDK submission). */
  widgetDomain?: string;
  /** Shared CSP applied to every widget. */
  csp?: CspConfig;
  /** LLM API key for chatRoutes. */
  apiKey?: string;
  /** LLM model for chatRoutes. */
  model?: string;
  /** System prompt for chatRoutes. Keep short. */
  systemPrompt?: string;
}

export interface DongHanhConfig {
  /** Glob pattern for operation files. */
  operations?: string;
  /** Named widget entries: name → entry file path. */
  widgets?: Record<string, string>;
  /** Server defaults consumed by gptRoutes / mcpRoutes / chatRoutes. */
  server?: ServerConfig;
}

/** Typed identity function for `donghanh.config.ts`. */
export function defineConfig(config: DongHanhConfig): DongHanhConfig {
  return config;
}

const CONFIG_NAMES = [
  "donghanh.config.ts",
  "donghanh.config.mjs",
  "donghanh.config.js",
];

export interface LoadedConfig {
  config: DongHanhConfig;
  path: string;
  root: string;
}

/** Find `donghanh.config.*` starting at `cwd`, walking up. */
export function findConfig(cwd = process.cwd()): string | null {
  let dir = resolve(cwd);
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Load `donghanh.config.ts` via dynamic import. Requires a runtime that can
 * import TS directly (Bun, tsx, node --experimental-strip-types).
 */
export async function loadConfig(
  cwd = process.cwd(),
): Promise<LoadedConfig | null> {
  const path = findConfig(cwd);
  if (!path) return null;
  const mod = (await import(pathToFileURL(path).href)) as {
    default?: DongHanhConfig;
    config?: DongHanhConfig;
  };
  const config = mod.default ?? mod.config;
  if (!config) {
    throw new Error(
      `${path} must default-export a DongHanhConfig (use defineConfig(...)).`,
    );
  }
  return { config, path, root: resolve(path, "..") };
}

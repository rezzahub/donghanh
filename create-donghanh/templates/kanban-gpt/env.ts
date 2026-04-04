export interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GPT_OAUTH_CLIENT_ID?: string;
  GPT_OAUTH_CLIENT_SECRET?: string;
}

let _env: Env | null = null;

export function setEnv(env: Env) {
  _env = env;
}

export function getEnv(): Env {
  if (_env) return _env;
  return process.env as unknown as Env;
}

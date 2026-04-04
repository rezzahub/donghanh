import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { db } from "./db";
import { getEnv } from "./env";

function createAuth() {
  const env = getEnv();
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite", usePlural: true }),
    plugins: [bearer()],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;

export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_, prop) {
    if (!_auth) _auth = createAuth();
    return (_auth as unknown as Record<string | symbol, unknown>)[prop];
  },
});

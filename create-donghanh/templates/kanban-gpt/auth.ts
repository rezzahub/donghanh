import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./db/schema";
import { getEnv } from "./env";

function createAuth() {
  const env = getEnv();
  const authDb = drizzle(env.DB, { schema });
  return betterAuth({
    database: drizzleAdapter(authDb, {
      provider: "sqlite",
      usePlural: true,
      schema,
    }),
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

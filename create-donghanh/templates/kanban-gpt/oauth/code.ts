import type { Context } from "hono";
import { auth } from "../auth";
import { db } from "../db";
import { oauthCodes } from "../db/schema";

export async function oauthCode(c: Context) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Not authenticated" }, 401);

  const { redirect_uri, state } = await c.req.json();
  if (!redirect_uri || !state) {
    return c.json({ error: "Missing redirect_uri or state" }, 400);
  }

  const code = crypto.randomUUID();
  await db.insert(oauthCodes).values({
    code,
    userId: session.user.id,
    sessionToken: session.session.token,
    redirectUri: redirect_uri,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });

  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return c.json({ url: url.toString() });
}

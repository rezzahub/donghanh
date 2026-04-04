import { and, eq, gt } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db";
import { oauthCodes } from "../db/schema";
import { getEnv } from "../env";

export async function oauthToken(c: Context) {
  const contentType = c.req.header("content-type") || "";
  let body: Record<string, string>;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(await c.req.text()));
  } else {
    body = await c.req.json();
  }

  const { client_id, client_secret, grant_type } = body;
  const env = getEnv();

  if (
    (env.GPT_OAUTH_CLIENT_ID && client_id !== env.GPT_OAUTH_CLIENT_ID) ||
    (env.GPT_OAUTH_CLIENT_SECRET &&
      client_secret !== env.GPT_OAUTH_CLIENT_SECRET)
  ) {
    return c.json({ error: "invalid_client" }, 403);
  }

  if (grant_type === "authorization_code") {
    const { code, redirect_uri } = body;
    const result = await db
      .select()
      .from(oauthCodes)
      .where(
        and(
          eq(oauthCodes.code, code),
          eq(oauthCodes.redirectUri, redirect_uri),
          gt(oauthCodes.expiresAt, Date.now()),
        ),
      )
      .get();

    if (!result) {
      return c.json(
        {
          error: "invalid_grant",
          error_description: "Code is invalid or expired",
        },
        400,
      );
    }

    // Delete used code
    await db.delete(oauthCodes).where(eq(oauthCodes.code, code));

    return c.json({
      access_token: result.sessionToken,
      token_type: "bearer",
      refresh_token: result.sessionToken,
      expires_in: 3600,
    });
  }

  if (grant_type === "refresh_token") {
    const { refresh_token } = body;
    if (!refresh_token) {
      return c.json(
        { error: "invalid_grant", error_description: "Missing refresh_token" },
        400,
      );
    }
    return c.json({
      access_token: refresh_token,
      token_type: "bearer",
      refresh_token,
      expires_in: 3600,
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
}

import type { Context } from "hono";
import { getEnv } from "../env";

export function oauthAuthorize(c: Context) {
  const url = new URL(c.req.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const clientId = url.searchParams.get("client_id");
  const responseType = url.searchParams.get("response_type");

  if (responseType !== "code") return c.text("Unsupported response_type", 400);
  if (!redirectUri || !state) return c.text("Missing required parameters", 400);

  const env = getEnv();
  if (env.GPT_OAUTH_CLIENT_ID && clientId !== env.GPT_OAUTH_CLIENT_ID) {
    return c.text("Invalid client_id", 403);
  }

  // TODO: replace with your login page URL
  const loginUrl = new URL("/login", c.req.url);
  loginUrl.searchParams.set("redirect_uri", redirectUri);
  loginUrl.searchParams.set("state", state);
  return c.redirect(loginUrl.toString());
}

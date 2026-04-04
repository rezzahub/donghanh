import { App, buildRegistry } from "@donghanh/core";
import { gptRoutes } from "@donghanh/hono";
import { Hono } from "hono";
import { auth } from "./auth";
import { type Env, setEnv } from "./env";
import { executor } from "./executor";
import { oauthAuthorize } from "./oauth/authorize";
import { oauthCode } from "./oauth/code";
import { oauthToken } from "./oauth/token";
import { operations } from "./operations";

const appNode = App({ operations });
const registry = buildRegistry(appNode);

const app = new Hono<{ Bindings: Env }>();

// Inject env bindings on each request
app.use("/*", async (c, next) => {
  setEnv(c.env);
  await next();
});

// GPT Store operations
app.route(
  "/api",
  gptRoutes({
    registry,
    executor,
    authenticate: async (request) => {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return {
          error: Response.json({ error: "Unauthorized" }, { status: 401 }),
        };
      }
      const token = authHeader.slice(7);
      const ctx = await auth.$context;
      const result = await ctx.internalAdapter.findSession(token);
      if (!result) {
        return {
          error: Response.json({ error: "Session expired" }, { status: 401 }),
        };
      }
      return { userId: result.user.id };
    },
  }),
);

// Better Auth
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// GPT Store OAuth
app.get("/oauth/authorize", (c) => oauthAuthorize(c));
app.post("/oauth/code", (c) => oauthCode(c));
app.post("/oauth/token", (c) => oauthToken(c));

app.get("/", (c) =>
  c.text("Kanban GPT running. Try GET /api/operations"),
);

export default app;

import { App, buildRegistry } from "@donghanh/core";
import { gptRoutes } from "@donghanh/hono";
import { Hono } from "hono";
import { createExecutor } from "./executor";
import { operations } from "./operations";

type Env = { Bindings: { DB: D1Database } };

const appNode = App({ operations });
const registry = buildRegistry(appNode);

const app = new Hono<Env>();

app.route(
  "/api",
  gptRoutes({
    registry,
    executor: async (opId, vars, ctx) => {
      const db = (ctx as any).db as D1Database;
      return createExecutor(db)(opId, vars, ctx);
    },
    authenticate: async () => ({ userId: "anonymous" }),
  }),
);

// Middleware to pass D1 to executor context
app.use("/api/*", async (c, next) => {
  (c as any).db = c.env.DB;
  await next();
});

app.get("/", (c) =>
  c.text("Mini Trello running. Try GET /api/operations"),
);

export default app;

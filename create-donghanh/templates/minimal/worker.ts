import { Hono } from "hono";
import { gptRoutes } from "@donghanh/hono";
import { buildRegistry, App } from "@donghanh/core";
import { operations } from "./operations";
import { createExecutor } from "./executor";

type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();

const appNode = App({ operations });
const registry = buildRegistry(appNode);

app.route("/api", gptRoutes({
  registry,
  executor: (opId, vars, ctx) => createExecutor((ctx as any).db)(opId, vars, ctx),
  authenticate: async (request) => ({ userId: "anonymous" }),
}));

// Inject D1 binding into executor context
app.use("/api/*", async (c, next) => {
  (c as any).db = c.env.DB;
  await next();
});

app.get("/", (c) => c.text("donghanh app running. Try GET /api/operations"));

export default app;

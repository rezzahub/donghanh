import { App, buildRegistry } from "@donghanh/core";
import { gptRoutes } from "@donghanh/hono";
import { Hono } from "hono";
import { createExecutor } from "./executor";
import { operations } from "./operations";

type Env = { Bindings: { DB: D1Database } };

const appNode = App({ operations });
const registry = buildRegistry(appNode);

const app = new Hono<Env>();

// Store DB reference for the executor
let _db: D1Database;

app.use("/*", async (c, next) => {
  _db = c.env.DB;
  await next();
});

app.route(
  "/api",
  gptRoutes({
    registry,
    executor: (opId, vars, ctx) => createExecutor(_db)(opId, vars, ctx),
    authenticate: async () => ({ userId: "anonymous" }),
  }),
);

app.get("/", (c) => c.text("donghanh app running. Try GET /api/operations"));

export default app;

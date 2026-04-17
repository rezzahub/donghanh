import { defineConfig } from "@donghanh/config";

export default defineConfig({
  operations: "./operations/**/*.tsx",
  widgets: {
    "task-card": "./widgets/task-card.tsx",
  },
  server: {
    // Replace with your deployed HTTPS URL for the MCP server.
    resource: "https://example.com",
    // Replace with your OAuth authorization server (Better Auth by default).
    authorizationServers: ["https://example.com"],
    scopes: [],
    widgetDomain: "https://example.com",
    csp: {
      connectDomains: [],
      resourceDomains: ["https://persistent.oaistatic.com"],
    },
  },
});

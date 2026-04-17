import { donghanhWidgets } from "@donghanh/widget-vite";
import { defineConfig } from "vite";
import config from "./donghanh.config";

export default defineConfig({
  build: {
    outDir: "manifest",
    emptyOutDir: false,
  },
  plugins: [
    donghanhWidgets({
      entries: config.widgets ?? {},
      outDir: "manifest",
      domain: config.server?.widgetDomain,
      csp: config.server?.csp,
    }),
  ],
});

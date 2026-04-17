// @ts-check
import cloudflare from "@astrojs/cloudflare";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://donghanh.dev",
  output: "static",
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    starlight({
      title: "@donghanh",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rezzahub/donghanh",
        },
      ],
      customCss: ["./src/styles/terminal.css"],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "guides/introduction" },
            { label: "Quick Start", slug: "guides/quickstart" },
          ],
        },
        {
          label: "Concepts",
          items: [
            { label: "Brief & Primitives", slug: "concepts/primitives" },
            { label: "Operations", slug: "concepts/operations" },
            { label: "Executor", slug: "concepts/executor" },
            { label: "Renderers", slug: "concepts/renderers" },
          ],
        },
        {
          label: "API Reference",
          autogenerate: { directory: "reference" },
        },
      ],
    }),
  ],
});

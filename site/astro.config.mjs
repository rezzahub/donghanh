// @ts-check
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
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

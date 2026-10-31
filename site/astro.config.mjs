// @ts-check
import cloudflare from "@astrojs/cloudflare";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { fontsUrl } from "./src/fonts.mjs";
import codeTheme from "./src/styles/code-theme.json" with { type: "json" };

export default defineConfig({
  site: "https://donghanh.dev",
  output: "static",
  adapter: cloudflare({ imageService: "compile" }),
  integrations: [
    starlight({
      title: "donghanh",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/rezzahub/donghanh",
        },
      ],
      customCss: ["./src/styles/docs.css"],
      head: [
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: true,
          },
        },
        { tag: "link", attrs: { rel: "stylesheet", href: fontsUrl } },
      ],
      components: {
        PageTitle: "./src/components/starlight/PageTitle.astro",
        SocialIcons: "./src/components/starlight/SocialIcons.astro",
        ThemeProvider: "./src/components/starlight/DarkThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/EmptyThemeSelect.astro",
      },
      expressiveCode: {
        themes: [codeTheme],
        styleOverrides: {
          borderColor: "#1f2125",
          borderRadius: "10px",
          codeBackground: "#131416",
          codeFontFamily: "var(--font-mono)",
          frames: {
            editorTabBarBackground: "#131416",
            terminalTitlebarBackground: "#131416",
            terminalBackground: "#131416",
            frameBoxShadowCssValue: "none",
          },
        },
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "guides/introduction" },
            { label: "Quick Start", slug: "guides/quickstart" },
            { label: "Many operations", slug: "guides/many-operations" },
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
        {
          label: "Resources",
          items: [
            {
              label: "AI coding skills",
              link: "https://github.com/rezzahub/donghanh/tree/main/skills",
              attrs: { target: "_blank" },
            },
            {
              label: "GitHub",
              link: "https://github.com/rezzahub/donghanh",
              attrs: { target: "_blank" },
            },
          ],
        },
      ],
    }),
  ],
});

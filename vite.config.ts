import { defineConfig } from "vite-plus";

const src = (file: string) => new URL(`./src/${file}`, import.meta.url).pathname;

export default defineConfig({
  root: "src",
  base: "./",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    modulePreload: false,
    minify: false,
    target: "es2022",
    rolldownOptions: {
      input: {
        background: src("background.ts"),
        content: src("content.ts"),
        options: src("options.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

type BrowserTarget = "chrome" | "firefox";

function manifestPlugin(target: BrowserTarget, outDir: string): Plugin {
  return {
    name: "context-tab-manager-manifest",
    async closeBundle() {
      const manifestPath = resolve(
        process.cwd(),
        "manifests",
        `${target}.json`
      );
      const manifest = await readFile(manifestPath, "utf8");

      await mkdir(resolve(process.cwd(), outDir), { recursive: true });
      await writeFile(
        resolve(process.cwd(), outDir, "manifest.json"),
        manifest,
        "utf8"
      );
    }
  };
}

export default defineConfig(({ mode }) => {
  const target: BrowserTarget = mode === "firefox" ? "firefox" : "chrome";
  const outDir = target === "firefox" ? "dist-firefox" : "dist";

  return {
    define: {
      __BROWSER_TARGET__: JSON.stringify(target)
    },
    publicDir: false,
    plugins: [svelte(), manifestPlugin(target, outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          manager: resolve(process.cwd(), "manager/index.html"),
          "service-worker": resolve(
            process.cwd(),
            "src/background/service-worker.ts"
          )
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  };
});

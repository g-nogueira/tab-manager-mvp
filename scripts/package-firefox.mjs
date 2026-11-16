import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const artifactsDir = join(root, "artifacts", "firefox");
const manifest = JSON.parse(
  readFileSync(join(root, "manifests", "firefox.json"), "utf8")
);
const version = manifest.version;

mkdirSync(artifactsDir, { recursive: true });

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npx,
  [
    "--yes",
    "web-ext@10.8.0",
    "build",
    "--source-dir",
    join(root, "dist-firefox"),
    "--artifacts-dir",
    artifactsDir,
    "--overwrite-dest",
    "--filename",
    `context-tab-manager-${version}.zip`
  ],
  {
    cwd: root,
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  `Firefox package: ${join(
    artifactsDir,
    `context-tab-manager-${version}.zip`
  )}`
);

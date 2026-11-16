import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const artifactsDir = join(root, "artifacts", "firefox");
const manifest = JSON.parse(
  readFileSync(join(root, "manifests", "firefox.json"), "utf8")
);
const version = manifest.version;
const sourceArchive = join(
  artifactsDir,
  `context-tab-manager-${version}-source.zip`
);

mkdirSync(artifactsDir, { recursive: true });

const result = spawnSync(
  "git",
  [
    "archive",
    "--format=zip",
    `--output=${sourceArchive}`,
    "HEAD"
  ],
  {
    cwd: root,
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Firefox source package: ${sourceArchive}`);

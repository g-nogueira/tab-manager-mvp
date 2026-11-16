import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  console.error(
    [
      "Firefox signing requires Mozilla AMO API credentials.",
      "Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET, then run this command again.",
      "Credentials are read from the environment and are never written to the repository."
    ].join("\n")
  );
  process.exit(2);
}

mkdirSync(artifactsDir, { recursive: true });

if (!existsSync(sourceArchive)) {
  console.error(
    `Source archive not found: ${sourceArchive}\nRun npm run package:firefox:source first.`
  );
  process.exit(2);
}

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npx,
  [
    "--yes",
    "web-ext@10.8.0",
    "sign",
    "--source-dir",
    join(root, "dist-firefox"),
    "--artifacts-dir",
    artifactsDir,
    "--channel",
    "unlisted",
    "--approval-timeout",
    "900000",
    "--upload-source-code",
    sourceArchive
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  `Mozilla signing completed for Context Tab Manager ${version}. Check ${artifactsDir} for the signed XPI.`
);

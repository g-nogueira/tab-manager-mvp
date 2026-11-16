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

const status = spawnSync(
  "git",
  ["status", "--porcelain"],
  {
    cwd: root,
    encoding: "utf8"
  }
);

if (status.status !== 0) {
  process.exit(status.status ?? 1);
}

if (status.stdout.trim().length > 0) {
  console.error(
    [
      "Refusing to create a Firefox signing source archive from a dirty working tree.",
      "Commit or stash your changes so the uploaded source matches the signed extension."
    ].join("\n")
  );
  process.exit(2);
}

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

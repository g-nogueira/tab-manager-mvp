import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const firefoxManifestPath = resolve(root, "manifests", "firefox.json");
const chromeManifestPath = resolve(root, "manifests", "chrome.json");
const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!match) {
    throw new Error(
      `Expected a numeric MAJOR.MINOR.PATCH version, got: ${version}`
    );
  }

  return match.slice(1).map(Number);
}

const firefoxManifest = readJson(firefoxManifestPath);
const chromeManifest = readJson(chromeManifestPath);
const packageJson = readJson(packagePath);

if (firefoxManifest.version !== chromeManifest.version) {
  throw new Error(
    `Browser manifest versions differ: Firefox=${firefoxManifest.version}, Chrome=${chromeManifest.version}`
  );
}

const [major, minor, patch] = parseVersion(firefoxManifest.version);
const nextVersion = `${major}.${minor}.${patch + 1}`;

firefoxManifest.version = nextVersion;
chromeManifest.version = nextVersion;
packageJson.version = nextVersion;

writeJson(firefoxManifestPath, firefoxManifest);
writeJson(chromeManifestPath, chromeManifest);
writeJson(packagePath, packageJson);

if (existsSync(packageLockPath)) {
  const packageLock = readJson(packageLockPath);
  packageLock.version = nextVersion;

  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = nextVersion;
  }

  writeJson(packageLockPath, packageLock);
}

if (process.env.GITHUB_OUTPUT) {
  writeFileSync(
    process.env.GITHUB_OUTPUT,
    `version=${nextVersion}\ntag=v${nextVersion}\n`,
    { flag: "a" }
  );
}

console.log(nextVersion);

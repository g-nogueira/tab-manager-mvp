import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const firefoxManifestPath = resolve(root, "manifests", "firefox.json");
const chromeManifestPath = resolve(root, "manifests", "chrome.json");
const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const releaseVersionPath = resolve(root, ".release-version");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());

  if (!match) {
    throw new Error(
      `Expected a numeric MAJOR.MINOR.PATCH version, got: ${version}`
    );
  }

  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

const firefoxManifest = readJson(firefoxManifestPath);
const chromeManifest = readJson(chromeManifestPath);
const packageJson = readJson(packagePath);

const knownVersions = [
  firefoxManifest.version,
  chromeManifest.version,
  packageJson.version
];

if (existsSync(releaseVersionPath)) {
  knownVersions.push(
    readFileSync(releaseVersionPath, "utf8").trim()
  );
}

if (process.env.RELEASE_VERSION_FLOOR) {
  knownVersions.push(
    process.env.RELEASE_VERSION_FLOOR.trim()
  );
}

const highest = knownVersions
  .map((version) => ({
    raw: version,
    parsed: parseVersion(version)
  }))
  .sort((a, b) =>
    compareVersions(b.parsed, a.parsed)
  )[0];

const [major, minor, patch] = highest.parsed;
const nextVersion = `${major}.${minor}.${patch + 1}`;

firefoxManifest.version = nextVersion;
chromeManifest.version = nextVersion;
packageJson.version = nextVersion;

writeJson(firefoxManifestPath, firefoxManifest);
writeJson(chromeManifestPath, chromeManifest);
writeJson(packagePath, packageJson);
writeFileSync(releaseVersionPath, nextVersion + "\n");

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

console.log(
  `Release floor: ${highest.raw}; next version: ${nextVersion}`
);

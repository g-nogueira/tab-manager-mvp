# Firefox Packaging and Signing

## Goals

The Firefox release workflow has three distinct outputs:

1. **development build** — `dist-firefox/`, loaded temporarily from `about:debugging`;
2. **unsigned package** — ZIP produced for validation/review and CI artifacts;
3. **signed unlisted XPI** — Mozilla-signed package for permanent self-distribution.

The add-on remains unlisted; signing does not require publishing it publicly on addons.mozilla.org.

## Commands

### Build

```bash
npm run build:firefox
```

### Unsigned package

```bash
npm run package:firefox
```

Produces:

```text
artifacts/firefox/context-tab-manager-<manifest-version>.zip
```

Packaging uses Mozilla `web-ext build`, so the archive contains the extension files themselves with `manifest.json` at the package root.

### Source package

```bash
npm run package:firefox:source
```

Produces:

```text
artifacts/firefox/context-tab-manager-<manifest-version>-source.zip
```

The source package is created from `git archive HEAD` and intentionally refuses to run on a dirty working tree. This ensures the human-readable source uploaded to AMO corresponds to a committed revision.

### Sign for self-distribution

Create AMO API credentials in Mozilla's Developer Hub, then expose them to the current shell:

```powershell
$env:WEB_EXT_API_KEY = "<JWT issuer>"
$env:WEB_EXT_API_SECRET = "<JWT secret>"
```

Run:

```bash
npm run sign:firefox
```

The signing workflow uses:

```text
web-ext sign
channel = unlisted
source-dir = dist-firefox
source-code = artifacts/firefox/*-source.zip
```

Secrets are passed through environment variables. They are not persisted in Git, configuration files or CLI arguments.

Mozilla returns a signed XPI into `artifacts/firefox/`. That XPI can be installed through Firefox's normal add-on installation UI and persists across restarts.

## Versioning

The stable Gecko ID is:

`context-tab-manager@g-nogueira.local`

This identity must remain stable across releases.

Each signed AMO submission must use a new add-on version. Before signing, increment `version` in the Firefox manifest and keep Chrome/Firefox manifest versions aligned.

## CI

CI does not sign because signing requires personal AMO credentials.

CI does:

1. build Chrome;
2. build Firefox;
3. run Mozilla `web-ext lint`;
4. create the unsigned Firefox package;
5. create the corresponding source archive;
6. upload both as the `firefox-packages` workflow artifact;
7. build the .NET companion.

This proves packaging remains reproducible without exposing signing secrets.

## Security

Never commit AMO API credentials.

Recommended local usage is environment variables scoped to the current shell. If signing is automated later, credentials should be stored in GitHub Actions secrets or an equivalent secret store and only exposed to a protected release workflow.


## GitHub Actions signing

A manual workflow is available:

`.github/workflows/firefox-release.yml`

Configure these repository secrets:

- `WEB_EXT_API_KEY`
- `WEB_EXT_API_SECRET`

Then run **Firefox Signed Release** from the repository Actions page.

The workflow validates the extension, creates the matching source archive, signs an unlisted build through Mozilla, and uploads:

```text
firefox-signed-release
├── *.xpi
└── *-source.zip
```

as a private GitHub Actions artifact.

The signing workflow is manual by design so ordinary pushes and pull requests never submit versions to AMO. Remember to increment the Firefox manifest version before each run.

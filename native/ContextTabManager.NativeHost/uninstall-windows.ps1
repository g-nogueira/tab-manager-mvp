[CmdletBinding()]
param(
    [ValidateSet('Chrome', 'Firefox', 'Both')]
    [string]$Browser = 'Both',

    [string]$InstallDirectory = (
        Join-Path $env:LOCALAPPDATA 'ContextTabManager\NativeHost'
    )
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.gnogueira.context_tab_manager'
$chromeRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$firefoxRegistryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"

if ($Browser -in @('Chrome', 'Both')) {
    if (Test-Path $chromeRegistryPath) {
        Remove-Item -Path $chromeRegistryPath -Recurse -Force
    }

    $chromeManifestPath = Join-Path $InstallDirectory 'native-host-manifest.chrome.json'
    if (Test-Path $chromeManifestPath) {
        Remove-Item -Path $chromeManifestPath -Force
    }
}

if ($Browser -in @('Firefox', 'Both')) {
    if (Test-Path $firefoxRegistryPath) {
        Remove-Item -Path $firefoxRegistryPath -Recurse -Force
    }

    $firefoxManifestPath = Join-Path $InstallDirectory 'native-host-manifest.firefox.json'
    if (Test-Path $firefoxManifestPath) {
        Remove-Item -Path $firefoxManifestPath -Force
    }
}

$chromeStillRegistered = Test-Path $chromeRegistryPath
$firefoxStillRegistered = Test-Path $firefoxRegistryPath

if (-not $chromeStillRegistered -and -not $firefoxStillRegistered -and (Test-Path $InstallDirectory)) {
    Remove-Item -Path $InstallDirectory -Recurse -Force
}

Write-Host "Uninstalled Context Tab Manager Native Host registration for: $Browser"

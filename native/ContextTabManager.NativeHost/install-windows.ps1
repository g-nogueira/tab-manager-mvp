[CmdletBinding()]
param(
    [ValidateSet('Chrome', 'Firefox', 'Both')]
    [string]$Browser = 'Chrome',

    [Alias('ExtensionId')]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ChromeExtensionId,

    [string]$FirefoxExtensionId = 'context-tab-manager@g-nogueira.local',

    [string]$InstallDirectory = (
        Join-Path $env:LOCALAPPDATA 'ContextTabManager\NativeHost'
    )
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.gnogueira.context_tab_manager'
$projectPath = Join-Path $PSScriptRoot 'ContextTabManager.NativeHost.csproj'
$runtime = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
$installChrome = $Browser -in @('Chrome', 'Both')
$installFirefox = $Browser -in @('Firefox', 'Both')

if ($installChrome -and [string]::IsNullOrWhiteSpace($ChromeExtensionId)) {
    throw 'ChromeExtensionId is required when installing for Chrome. The legacy -ExtensionId parameter name is also supported.'
}

if ($installFirefox -and [string]::IsNullOrWhiteSpace($FirefoxExtensionId)) {
    throw 'FirefoxExtensionId is required when installing for Firefox.'
}

function Write-JsonWithoutBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [object]$Value
    )

    $json = $Value | ConvertTo-Json -Depth 6
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json, $utf8WithoutBom)
}

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null

dotnet publish $projectPath --configuration Release --runtime $runtime --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false --output $InstallDirectory

if ($LASTEXITCODE -ne 0) {
    throw 'dotnet publish failed.'
}

$executablePath = Join-Path $InstallDirectory 'ContextTabManager.NativeHost.exe'

if ($installChrome) {
    $chromeManifestPath = Join-Path $InstallDirectory 'native-host-manifest.chrome.json'
    $chromeManifest = [ordered]@{
        name = $hostName
        description = 'Context Tab Manager desktop companion'
        path = $executablePath
        type = 'stdio'
        allowed_origins = @(
            "chrome-extension://$ChromeExtensionId/"
        )
    }

    Write-JsonWithoutBom -Path $chromeManifestPath -Value $chromeManifest

    $chromeRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
    New-Item -Path $chromeRegistryPath -Force | Out-Null
    Set-Item -Path $chromeRegistryPath -Value $chromeManifestPath

    Write-Host 'Registered Native Messaging host for Chrome.'
    Write-Host "Chrome extension ID: $ChromeExtensionId"
    Write-Host "Chrome manifest: $chromeManifestPath"
}

if ($installFirefox) {
    $firefoxManifestPath = Join-Path $InstallDirectory 'native-host-manifest.firefox.json'
    $firefoxManifest = [ordered]@{
        name = $hostName
        description = 'Context Tab Manager desktop companion'
        path = $executablePath
        type = 'stdio'
        allowed_extensions = @(
            $FirefoxExtensionId
        )
    }

    Write-JsonWithoutBom -Path $firefoxManifestPath -Value $firefoxManifest

    $firefoxRegistryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"
    New-Item -Path $firefoxRegistryPath -Force | Out-Null
    Set-Item -Path $firefoxRegistryPath -Value $firefoxManifestPath

    Write-Host 'Registered Native Messaging host for Firefox.'
    Write-Host "Firefox extension ID: $FirefoxExtensionId"
    Write-Host "Firefox manifest: $firefoxManifestPath"
}

Write-Host "Native host executable: $executablePath"
Write-Host 'Reload the target browser extension before testing Focus.'

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,

    [string]$InstallDirectory = (
        Join-Path $env:LOCALAPPDATA 'ContextTabManager\NativeHost'
    )
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.gnogueira.context_tab_manager'
$projectPath = Join-Path $PSScriptRoot 'ContextTabManager.NativeHost.csproj'
$runtime = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }

New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null

dotnet publish $projectPath --configuration Release --runtime $runtime --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false --output $InstallDirectory

if ($LASTEXITCODE -ne 0) {
    throw 'dotnet publish failed.'
}

$executablePath = Join-Path $InstallDirectory 'ContextTabManager.NativeHost.exe'
$manifestPath = Join-Path $InstallDirectory 'native-host-manifest.json'

$manifest = [ordered]@{
    name = $hostName
    description = 'Context Tab Manager desktop companion'
    path = $executablePath
    type = 'stdio'
    allowed_origins = @(
        "chrome-extension://$ExtensionId/"
    )
} | ConvertTo-Json -Depth 4

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($manifestPath, $manifest, $utf8WithoutBom)

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Installed Context Tab Manager Native Host."
Write-Host "Extension ID: $ExtensionId"
Write-Host "Manifest: $manifestPath"
Write-Host 'Reload the Chrome extension before testing Focus.'

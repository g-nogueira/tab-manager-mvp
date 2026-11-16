[CmdletBinding()]
param(
    [string]$InstallDirectory = (
        Join-Path $env:LOCALAPPDATA 'ContextTabManager\NativeHost'
    )
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.gnogueira.context_tab_manager'
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"

if (Test-Path $registryPath) {
    Remove-Item -Path $registryPath -Recurse -Force
}

if (Test-Path $InstallDirectory) {
    Remove-Item -Path $InstallDirectory -Recurse -Force
}

Write-Host 'Uninstalled Context Tab Manager Native Host.'

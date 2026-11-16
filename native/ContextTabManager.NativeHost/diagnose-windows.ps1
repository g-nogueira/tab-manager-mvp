[CmdletBinding()]
param(
    [ValidateSet('Chrome', 'Firefox')]
    [string]$Browser = 'Chrome',

    [Alias('ExtensionId')]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ChromeExtensionId,

    [string]$FirefoxExtensionId = 'context-tab-manager@g-nogueira.local'
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.gnogueira.context_tab_manager'

if ($Browser -eq 'Chrome') {
    if ([string]::IsNullOrWhiteSpace($ChromeExtensionId)) {
        throw 'ChromeExtensionId is required for Chrome diagnostics. The legacy -ExtensionId parameter name is also supported.'
    }

    $registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
    $expectedPermissionKey = 'allowed_origins'
    $expectedPermissionValue = "chrome-extension://$ChromeExtensionId/"
}
else {
    $registryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\$hostName"
    $expectedPermissionKey = 'allowed_extensions'
    $expectedPermissionValue = $FirefoxExtensionId
}

function Write-Check {
    param(
        [bool]$Ok,
        [string]$Message
    )

    $prefix = if ($Ok) { '[OK]  ' } else { '[FAIL]' }
    Write-Host "$prefix $Message"
}

Write-Host "Context Tab Manager companion diagnostics"
Write-Host "Browser: $Browser"

if ($Browser -eq 'Chrome') {
    Write-Host "Chrome extension ID: $ChromeExtensionId"
}
else {
    Write-Host "Firefox extension ID: $FirefoxExtensionId"
}

Write-Host ""

if (-not (Test-Path $registryPath)) {
    Write-Check $false "Registry key not found: $registryPath"
    exit 1
}

Write-Check $true "Registry key exists."

$manifestPath = (Get-Item $registryPath).GetValue('')

if ([string]::IsNullOrWhiteSpace($manifestPath)) {
    Write-Check $false 'Registry default value does not contain a manifest path.'
    exit 1
}

Write-Check $true "Registered manifest: $manifestPath"

if (-not (Test-Path $manifestPath)) {
    Write-Check $false 'Native Messaging manifest file does not exist.'
    exit 1
}

Write-Check $true 'Native Messaging manifest exists.'

try {
    $manifest = Get-Content -Raw -Path $manifestPath | ConvertFrom-Json
}
catch {
    Write-Check $false "Manifest is not valid JSON: $($_.Exception.Message)"
    exit 1
}

if ($manifest.name -ne $hostName) {
    Write-Check $false "Manifest name is '$($manifest.name)', expected '$hostName'."
}
else {
    Write-Check $true "Manifest host name is correct: $hostName"
}

$allowedValues = @($manifest.$expectedPermissionKey)

if ($allowedValues -notcontains $expectedPermissionValue) {
    Write-Check $false "Manifest does not allow this extension: $expectedPermissionValue"
    Write-Host "       $expectedPermissionKey: $($allowedValues -join ', ')"
}
else {
    Write-Check $true "Manifest allows extension: $expectedPermissionValue"
}

$executablePath = [string]$manifest.path

if ([string]::IsNullOrWhiteSpace($executablePath) -or -not (Test-Path $executablePath)) {
    Write-Check $false "Native host executable not found: $executablePath"
    exit 1
}

Write-Check $true "Native host executable exists: $executablePath"

Write-Host ""
Write-Host 'Testing direct getStatus round-trip...'

$process = $null

try {
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $executablePath
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo

    if (-not $process.Start()) {
        throw 'Process.Start returned false.'
    }

    $requestJson = '{"command":"getStatus","requestId":"diagnose"}'
    $payload = [System.Text.Encoding]::UTF8.GetBytes($requestJson)
    $length = [System.BitConverter]::GetBytes([uint32]$payload.Length)

    $stdin = $process.StandardInput.BaseStream
    $stdin.Write($length, 0, $length.Length)
    $stdin.Write($payload, 0, $payload.Length)
    $stdin.Flush()

    $stdout = $process.StandardOutput.BaseStream
    $header = New-Object byte[] 4

    $read = 0
    while ($read -lt 4) {
        $count = $stdout.Read($header, $read, 4 - $read)

        if ($count -eq 0) {
            throw 'Host exited before returning a Native Messaging length header.'
        }

        $read += $count
    }

    $responseLength = [System.BitConverter]::ToUInt32($header, 0)

    if ($responseLength -eq 0 -or $responseLength -gt 1048576) {
        throw "Host returned invalid payload length: $responseLength"
    }

    $responseBytes = New-Object byte[] $responseLength
    $read = 0

    while ($read -lt $responseLength) {
        $count = $stdout.Read(
            $responseBytes,
            $read,
            [int]($responseLength - $read)
        )

        if ($count -eq 0) {
            throw 'Host exited before returning the complete response.'
        }

        $read += $count
    }

    $responseJson = [System.Text.Encoding]::UTF8.GetString($responseBytes)
    $response = $responseJson | ConvertFrom-Json

    if (-not $response.ok) {
        throw "Host responded with an error: $($response.error)"
    }

    Write-Check $true 'Native host getStatus round-trip succeeded.'
    Write-Host "       Host version: $($response.status.hostVersion)"
    Write-Host "       Protocol: v$($response.status.protocolVersion)"
    Write-Host "       Platform: $($response.status.platform)"
    Write-Host "       Focus capability: $($response.status.canPrepareDesktopForFocus)"
}
catch {
    Write-Check $false "Direct host round-trip failed: $($_.Exception.Message)"

    if ($process -and -not $process.HasExited) {
        $process.Kill()
    }

    if ($process) {
        $stderr = $process.StandardError.ReadToEnd()

        if (-not [string]::IsNullOrWhiteSpace($stderr)) {
            Write-Host "       Host stderr: $stderr"
        }
    }

    exit 1
}
finally {
    if ($process) {
        try {
            $process.StandardInput.Close()
        }
        catch {
        }

        if (-not $process.HasExited) {
            $process.WaitForExit(1000) | Out-Null
        }

        if (-not $process.HasExited) {
            $process.Kill()
        }

        $process.Dispose()
    }
}

$logPath = Join-Path $env:LOCALAPPDATA 'ContextTabManager\NativeHost\logs\native-host.log'

Write-Host ""
Write-Host "Native host diagnostic log: $logPath"

if (Test-Path $logPath) {
    Write-Host 'Recent native-host log entries:'
    Get-Content -Path $logPath -Tail 20 | ForEach-Object {
        Write-Host "       $_"
    }
}
else {
    Write-Host '       No native-host file log exists yet.'
}

Write-Host ""
Write-Host "Local $Browser companion registration and direct host health are valid."
Write-Host 'If the browser still fails, compare the request ID in extension diagnostics with native-host.log.'

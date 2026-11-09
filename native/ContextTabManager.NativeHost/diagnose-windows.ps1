[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'

$hostName = 'com.gnogueira.context_tab_manager'
$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
$expectedOrigin = "chrome-extension://$ExtensionId/"

function Write-Check {
    param(
        [bool]$Ok,
        [string]$Message
    )

    $prefix = if ($Ok) { '[OK]  ' } else { '[FAIL]' }
    Write-Host "$prefix $Message"
}

Write-Host "Context Tab Manager companion diagnostics"
Write-Host "Extension ID: $ExtensionId"
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

$allowedOrigins = @($manifest.allowed_origins)
if ($allowedOrigins -notcontains $expectedOrigin) {
    Write-Check $false "Manifest does not allow this extension origin: $expectedOrigin"
    Write-Host "       Allowed origins: $($allowedOrigins -join ', ')"
}
else {
    Write-Check $true "Manifest allows extension origin: $expectedOrigin"
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

    $requestJson = '{"command":"getStatus"}'
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

Write-Host ""
Write-Host 'Local companion registration and direct host health are valid.'
Write-Host 'If Chrome still reports unavailable, reload the extension and inspect chrome://extensions for Native Messaging errors.'

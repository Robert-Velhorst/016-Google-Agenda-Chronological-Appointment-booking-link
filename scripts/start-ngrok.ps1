[CmdletBinding()]
param(
  [string]$PublicUrl,
  [switch]$RandomUrl
)
$ErrorActionPreference = 'Stop'
if (-not $PublicUrl -and -not $RandomUrl) { throw 'Provide -PublicUrl https://your-domain.example or use -RandomUrl for a temporary tunnel.' }
if ($PublicUrl -and $RandomUrl) { throw 'Choose either -PublicUrl or -RandomUrl.' }

$ngrok = Get-Command ngrok -ErrorAction Stop
$node = Get-Command node -ErrorAction Stop
$root = Split-Path -Parent $PSScriptRoot
$ngrokOut = Join-Path $env:TEMP "chronological-ngrok-$PID.log"
$ngrokErr = Join-Path $env:TEMP "chronological-ngrok-$PID.err.log"
$serverOut = Join-Path $env:TEMP "chronological-server-$PID.log"
$serverErr = Join-Path $env:TEMP "chronological-server-$PID.err.log"
$tunnel = $null
$server = $null

function Assert-Running($process, [string]$name, [string]$logPath) {
  if ($process.HasExited) {
    $detail = (Get-Content -LiteralPath $logPath -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine
    throw "$name stopped before becoming ready. $detail"
  }
}

Push-Location $root
try {
  $arguments = @('http', '8787', '--log', 'stdout', '--log-format', 'logfmt')
  if ($PublicUrl) {
    $uri = [Uri]$PublicUrl
    if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $uri.UserInfo) { throw 'PublicUrl must be an HTTPS origin without credentials, path, query, or fragment.' }
    $resolvedUrl = $uri.GetLeftPart([UriPartial]::Authority)
    $arguments += @('--url', $resolvedUrl)
  }
  $tunnel = Start-Process -FilePath $ngrok.Source -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $ngrokOut -RedirectStandardError $ngrokErr

  if (-not $PublicUrl) {
    $resolvedUrl = $null
    for ($attempt = 0; $attempt -lt 30 -and -not $resolvedUrl; $attempt += 1) {
      Start-Sleep -Milliseconds 500
      Assert-Running $tunnel 'ngrok' $ngrokOut
      $log = (Get-Content -LiteralPath $ngrokOut -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $ngrokErr -Raw -ErrorAction SilentlyContinue)
      $match = [regex]::Match($log, 'https://[a-zA-Z0-9.-]+(?:\.ngrok-free\.(?:app|dev)|\.ngrok\.(?:app|dev))')
      if ($match.Success) { $resolvedUrl = $match.Value }
    }
    if (-not $resolvedUrl) { throw 'ngrok did not report an HTTPS endpoint within 15 seconds.' }
    Write-Warning 'This temporary URL can change; update the Google OAuth redirect registration before connecting Google.'
  } else {
    Start-Sleep -Seconds 2
    Assert-Running $tunnel 'ngrok' $ngrokOut
  }

  $env:APP_ENV = 'production'
  $env:HOST = '127.0.0.1'
  $env:BASE_URL = $resolvedUrl
  $env:GOOGLE_REDIRECT_URI = "$resolvedUrl/oauth/google/callback"
  $env:TRUST_PROXY = 'true'
  $server = Start-Process -FilePath $node.Source -ArgumentList @('src/server.js') -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr

  $localReady = $false
  for ($attempt = 0; $attempt -lt 30 -and -not $localReady; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    Assert-Running $server 'booking server' $serverErr
    try { $localReady = (Invoke-RestMethod -Uri 'http://127.0.0.1:8787/healthz' -TimeoutSec 2).status -eq 'ok' } catch {}
  }
  if (-not $localReady) { throw 'The local booking server did not become healthy within 15 seconds.' }

  $publicReady = $false
  for ($attempt = 0; $attempt -lt 20 -and -not $publicReady; $attempt += 1) {
    Start-Sleep -Seconds 1
    Assert-Running $tunnel 'ngrok' $ngrokOut
    try { $publicReady = (Invoke-RestMethod -Uri "$resolvedUrl/healthz" -Headers @{'ngrok-skip-browser-warning'='health-check'} -TimeoutSec 5).status -eq 'ok' } catch {}
  }
  if (-not $publicReady) { throw 'The ngrok HTTPS endpoint did not pass the public health check within 20 seconds.' }

  Write-Host "Public booking service: $resolvedUrl"
  Write-Host "Google OAuth redirect: $resolvedUrl/oauth/google/callback"
  Write-Host 'Press Ctrl+C to stop the server and tunnel.'
  while (-not $server.HasExited -and -not $tunnel.HasExited) { Start-Sleep -Seconds 1 }
  Assert-Running $server 'booking server' $serverErr
  Assert-Running $tunnel 'ngrok' $ngrokOut
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
  Pop-Location
}

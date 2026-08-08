[CmdletBinding()]
param(
  [string]$PublicUrl,
  [switch]$RandomUrl
)
$ErrorActionPreference = 'Stop'
if (-not $PublicUrl -and -not $RandomUrl) { throw 'Provide -PublicUrl https://your-domain.example or use -RandomUrl for a temporary test tunnel.' }
if ($PublicUrl -and $RandomUrl) { throw 'Choose either -PublicUrl or -RandomUrl.' }
$ngrok = Get-Command ngrok -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if ($PublicUrl) {
    $uri = [Uri]$PublicUrl
    if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/') { throw 'PublicUrl must be an HTTPS origin without a path.' }
    $env:APP_ENV = 'production'
    $env:BASE_URL = $uri.GetLeftPart([UriPartial]::Authority)
    $env:GOOGLE_REDIRECT_URI = "$($env:BASE_URL)/oauth/google/callback"
    $server = Start-Process -FilePath $npm.Source -ArgumentList @('start') -PassThru -WindowStyle Hidden
    try { & $ngrok.Source http 8787 --url $env:BASE_URL } finally { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
  } else {
    Write-Warning 'A random URL changes on restart and is unsuitable for a stable Google OAuth redirect.'
    $server = Start-Process -FilePath $npm.Source -ArgumentList @('start') -PassThru -WindowStyle Hidden
    try { & $ngrok.Source http 8787 } finally { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
  }
} finally { Pop-Location }

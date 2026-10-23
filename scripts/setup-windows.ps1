[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer is for Windows 11.' }
$node = Get-Command node -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop
$version = [version]((& $node.Source --version).TrimStart('v'))
if ($version -lt [version]'26.12.1' -or $version -ge [version]'27.0.0') { throw "Node.js 26.12.1 or newer within Node 26 is required; found $version." }

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  Add-Type -AssemblyName System.Security
  function New-RandomHex([int]$bytes) {
    $buffer = New-Object byte[] $bytes
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return ([BitConverter]::ToString($buffer) -replace '-', '').ToLowerInvariant()
  }
  $content = @(
    'APP_ENV=development'
    'HOST=127.0.0.1'
    'PORT=8787'
    'BASE_URL=http://localhost:8787'
    'DATABASE_PATH=./data/booking.sqlite'
    "ADMIN_TOKEN=$(New-RandomHex 24)"
    "ENCRYPTION_KEY=$(New-RandomHex 32)"
    "HAI_CONNECTOR_TOKEN=$(New-RandomHex 32)"
    'HAI_CONNECTOR_PROJECT_KEY=016-Google-Agenda'
  )
  [IO.File]::WriteAllLines($envFile, $content, [Text.UTF8Encoding]::new($false))
  Write-Host 'Created a private .env with random local credentials.'
} else {
  Write-Host 'Preserving the existing .env file.'
}

Push-Location $root
try {
  & $npm.Source ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  & $npm.Source run build:sqlite
  if ($LASTEXITCODE -ne 0) { throw 'Current SQLite build failed. Python 3.15.1 and C++ build tools are required.' }
  & $npm.Source run verify:runtime
  if ($LASTEXITCODE -ne 0) { throw 'Native runtime qualification failed.' }
  & $npm.Source run build
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
  & $npm.Source run migrate
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
  & $npm.Source run doctor
  if ($LASTEXITCODE -ne 0) { throw 'Readiness checks failed.' }
  Write-Host 'Setup complete. Run start-windows.cmd, then open http://localhost:8787.'
} finally { Pop-Location }

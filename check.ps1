# Oakbridge — complete code check (backend syntax + deps, frontend build)
# Usage:  powershell -ExecutionPolicy Bypass -File .\check.ps1
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$fail = 0

Write-Host "`n=== 1/3  Backend: Python syntax (compileall) ===" -ForegroundColor Cyan
$venv = Join-Path $root "backend\.venv\Scripts\python.exe"
$py = if (Test-Path $venv) { $venv } else { "python" }
& $py -m compileall (Join-Path $root "backend") -q
if ($LASTEXITCODE -eq 0) { Write-Host "OK - all Python files parse" -ForegroundColor Green }
else { Write-Host "FAIL - syntax error above" -ForegroundColor Red; $fail = 1 }

Write-Host "`n=== 2/3  Backend: dependency check (pip check) ===" -ForegroundColor Cyan
& $py -m pip check
if ($LASTEXITCODE -eq 0) { Write-Host "OK - dependencies consistent" -ForegroundColor Green }
else { Write-Host "WARN - dependency issues above" -ForegroundColor Yellow }

Write-Host "`n=== 3/3  Frontend: production build (yarn build) ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "frontend")
yarn build
if ($LASTEXITCODE -eq 0) { Write-Host "OK - frontend compiled" -ForegroundColor Green }
else { Write-Host "FAIL - build error above" -ForegroundColor Red; $fail = 1 }
Pop-Location

Write-Host "`n============================================" -ForegroundColor Cyan
if ($fail -eq 0) { Write-Host "ALL CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "CHECKS FAILED - see red output above" -ForegroundColor Red }
exit $fail

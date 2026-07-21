@echo off
setlocal
set "SCRIPT_URL=https://faolla.com/downloads/print-helper/install-faolla-print-helper.ps1?v=20260722a"
set "SCRIPT_SHA256=32ac2e21845944bfd7ff57187525b9dc8e59af4084fafbb62656affac2bea55d"
set "SCRIPT_PATH=%TEMP%\install-faolla-print-helper.ps1"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

echo FAOLLA print helper installer
echo Downloading installer script...
"%POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '%SCRIPT_URL%' -OutFile '%SCRIPT_PATH%' -UseBasicParsing; $actual=(Get-FileHash -LiteralPath '%SCRIPT_PATH%' -Algorithm SHA256).Hash.ToLowerInvariant(); if ($actual -ne '%SCRIPT_SHA256%') { throw 'installer_script_sha256_mismatch' }; & '%SCRIPT_PATH%'"
if errorlevel 1 (
  echo.
  echo Install failed. Please keep this window open and contact FAOLLA support with the error above.
  pause
  exit /b 1
)

echo.
echo Install finished. You can return to FAOLLA and click Detect Helper.
pause

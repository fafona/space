@echo off
cd /d d:\merchant-space
"C:\Program Files\nodejs\node.exe" scripts\check-env.mjs > logs\dev.log 2> logs\dev.err.log
if errorlevel 1 exit /b 1
"C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next dev --webpack -p 3000 >> logs\dev.log 2>> logs\dev.err.log

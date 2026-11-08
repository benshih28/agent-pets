@echo off
setlocal
rem UTF-8 so a non-ASCII user name in the node path survives cmd's parsing.
chcp 65001 >nul 2>nul

set "SCRIPT_DIR=%~dp0"

"__NODE_EXECUTABLE__" "%SCRIPT_DIR%agent-hook.mjs" %* >nul 2>nul

exit /b 0

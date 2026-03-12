@ECHO off

CHCP 65001 > NUL
CD /d "%~dp0"

IF NOT EXIST ts-bot\dist\main.js (
    ECHO ERROR: Missing ts-bot\dist\main.js
    ECHO Run install.ps1 or npm run build --prefix ts-bot first.
    GOTO end
)

node --version > NUL 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO nonode

CMD /k node ts-bot\dist\main.js %*
GOTO end

:nonode
ECHO ERROR: Node.js has either not been installed or not added to your PATH.

:end
PAUSE

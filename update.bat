@ECHO off

CHCP 65001 > NUL
CD /d "%~dp0"

node --version > NUL 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO nonode

npm --version > NUL 2>&1
IF %ERRORLEVEL% NEQ 0 GOTO nonpm

CALL npm install --prefix ts-bot
IF %ERRORLEVEL% NEQ 0 GOTO end

CALL npm run build --prefix ts-bot
GOTO end

:nonode
ECHO ERROR: Node.js has either not been installed or not added to your PATH.
GOTO end

:nonpm
ECHO ERROR: npm has either not been installed or not added to your PATH.

:end
PAUSE

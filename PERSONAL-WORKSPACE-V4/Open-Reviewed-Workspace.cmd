@echo off
setlocal
rem Opens the reviewed build with isolated acceptance data; never the live workspace.
set "PORTABLE_EXECUTABLE_DIR=%~dp0test-results\ui-audit-fixes-20260912\disposable-runtime"
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0release\ui-audit-fixed-20260912\win-unpacked\SCT Workspace.exe" "--user-data-dir=%PORTABLE_EXECUTABLE_DIR%\profile"

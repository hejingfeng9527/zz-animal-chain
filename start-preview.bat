@echo off
chcp 65001 >nul 2>&1
setlocal

REM  zz-animal-chain  local preview server
REM  Double-click to start, then open http://127.0.0.1:8902/

pushd "%~dp0"

set "BASH_EXE="
for %%P in (
  "%ProgramFiles%\Git\bin\bash.exe"
  "%ProgramFiles(x86)%\Git\bin\bash.exe"
  "%LocalPrograms%\Git\bin\bash.exe"
  "%ProgramFiles%\Git\usr\bin\bash.exe"
) do (
  if not defined BASH_EXE if exist %%P set "BASH_EXE=%%~P"
)

if not defined BASH_EXE (
  where bash >nul 2>&1
  if %errorlevel%==0 set "BASH_EXE=bash"
)

if not defined BASH_EXE (
  echo.
  echo [ERROR] Git Bash not found. Please install: https://git-scm.com/download/win
  echo.
  pause
  popd
  exit /b 1
)

"%BASH_EXE%" "%~dp0start-preview.sh" %*

popd
endlocal

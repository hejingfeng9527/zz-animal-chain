@echo off
chcp 65001 >nul 2>&1
setlocal

REM  zz-animal-chain  one-click GitHub Pages deploy
REM  Double-click this file, then enter your GitHub username and token.

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
  echo [ERROR] Git Bash not found.
  echo Please install Git for Windows: https://git-scm.com/download/win
  echo Or run this command manually inside Git Bash:
  echo     bash "%~dp0deploy-github.sh"
  echo.
  pause
  popd
  exit /b 1
)

"%BASH_EXE%" "%~dp0deploy-github.sh" %*

echo.
pause
popd
endlocal

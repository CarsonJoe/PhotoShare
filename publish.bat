@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM Determine repo root (folder of this script)
set REPO_ROOT=%~dp0
pushd "%REPO_ROOT%" >nul

echo [0/3] Importing staged edits (if any)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%app\import_staging.ps1"

echo [1/3] Generating photo manifest...
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO_ROOT%app\generate_manifest.ps1"
if errorlevel 1 (
  echo Failed to generate manifest.
  popd & exit /b 1
)

if not exist .nojekyll (
  type nul > .nojekyll
)

echo [2/3] Adding and committing changes...
git add -A
rem Reset change detector each run
set CHANGES=
for /f "delims=" %%a in ('git status --porcelain') do set CHANGES=1
if defined CHANGES (
  rem Build a stable timestamp via PowerShell to avoid locale quirks
  for /f "delims=" %%t in ('powershell -NoProfile -Command "(Get-Date).ToString(\"yyyy-MM-dd HH:mm:ss\")"') do set TS=%%t
  if not defined TS set TS=now
  set COMMIT_MSG=Publish: !TS!
  echo Committing with message: !COMMIT_MSG!
  git commit -m "!COMMIT_MSG!"
) else (
  echo No changes to commit.
)

echo [3/3] Pushing to origin...
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
if not defined BRANCH set BRANCH=main
echo Current branch: %BRANCH%
git push origin %BRANCH%
if errorlevel 1 (
  echo Push failed. Ensure the remote is set and you are logged in.
  popd & exit /b 1
)

echo Done. If not already, enable GitHub Pages for this repo (Settings > Pages > Deploy from main, root).
popd
exit /b 0

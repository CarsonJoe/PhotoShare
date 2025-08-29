@echo off
setlocal enableextensions

REM Determine repo root (folder of this script)
set REPO_ROOT=%~dp0
pushd "%REPO_ROOT%" >nul

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
for /f "tokens=*" %%a in ('git status --porcelain') do set CHANGES=1
if defined CHANGES (
  set COMMIT_MSG=Publish: %DATE% %TIME%
  git commit -m "%COMMIT_MSG%"
) else (
  echo No changes to commit.
)

echo [3/3] Pushing to origin...
git push
if errorlevel 1 (
  echo Push failed. Ensure the remote is set and you are logged in.
  popd & exit /b 1
)

echo Done. If not already, enable GitHub Pages for this repo (Settings > Pages > Deploy from main, root).
popd
exit /b 0


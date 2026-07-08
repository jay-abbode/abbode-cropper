@echo off
REM ── Abbode Cropper: commit & push current changes ────────────────
REM This does NOT modify your git remote. It only stages, commits,
REM and pushes to whatever remote is already configured.
REM
REM One-time setup only (skip if your repo is already linked):
REM   git remote set-url origin https://github.com/<your-username>/abbode-cropper.git

git add .
git commit -m "Update Abbode Cropper"
git push
pause

@echo off
REM ── Abbode Cropper: first push to GitHub ─────────────────────────
REM 1. Create an empty repo named abbode-cropper on GitHub first.
REM 2. Replace YOURUSER below, then double-click this file.

set REPO=https://github.com/YOURUSER/abbode-cropper.git

git init
git add .
git commit -m "Abbode Cropper v1 — batch crop, visualizer, QC carousel, manual edit"
git branch -M main
git remote remove origin 2>nul
git remote add origin %REPO%
git push -u origin main
pause

@echo off
echo Building SWG Tracker Desktop...
cd /d "%~dp0\.."
python -m PyInstaller build/build.spec --clean
echo Build complete! Check dist/ folder.
pause

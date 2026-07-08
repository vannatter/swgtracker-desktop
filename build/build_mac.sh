#!/bin/bash
# Build the standalone macOS app: ./venv/bin/python required (has pyinstaller).
# Output: dist/SWG Tracker Desktop.app
set -e
cd "$(dirname "$0")/.."
./venv/bin/pyinstaller --noconfirm --clean --windowed \
  --name "SWG Tracker Desktop" \
  --icon build/icon.icns \
  --osx-bundle-identifier com.swgtracker.desktop \
  --add-data "web:web" \
  --add-data "src/resources:src/resources" \
  run_web.py
echo "built: dist/SWG Tracker Desktop.app"

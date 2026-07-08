#!/bin/bash
# Creates a macOS .app bundle that wraps the Python script.
# This gives us a proper Dock icon and app name during development.
#
# Usage: ./build/create_mac_app.sh
# Then:  open "SWG Tracker Desktop.app"

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="SWG Tracker Desktop"
APP_DIR="$PROJECT_DIR/$APP_NAME.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

# Find python in venv or system
if [ -f "$PROJECT_DIR/venv/bin/python" ]; then
    PYTHON="$PROJECT_DIR/venv/bin/python"
else
    PYTHON="$(which python3.12 2>/dev/null || which python3)"
fi

echo "Using Python: $PYTHON"
echo "Creating $APP_NAME.app..."

# Clean previous
rm -rf "$APP_DIR"

# Create structure
mkdir -p "$MACOS" "$RESOURCES"

# Create the launcher script
cat > "$MACOS/$APP_NAME" << LAUNCHER
#!/bin/bash
cd "$PROJECT_DIR"
exec "$PYTHON" "$PROJECT_DIR/src/main.py" "\$@"
LAUNCHER
chmod +x "$MACOS/$APP_NAME"

# Convert PNG to icns for macOS
if command -v sips &>/dev/null && [ -f "$PROJECT_DIR/src/resources/icon.png" ]; then
    ICONSET="$RESOURCES/icon.iconset"
    mkdir -p "$ICONSET"

    sips -z 16 16     "$PROJECT_DIR/src/resources/icon.png" --out "$ICONSET/icon_16x16.png"      >/dev/null 2>&1
    sips -z 32 32     "$PROJECT_DIR/src/resources/icon.png" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null 2>&1
    sips -z 32 32     "$PROJECT_DIR/src/resources/icon.png" --out "$ICONSET/icon_32x32.png"      >/dev/null 2>&1
    sips -z 64 64     "$PROJECT_DIR/src/resources/icon.png" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null 2>&1
    sips -z 128 128   "$PROJECT_DIR/src/resources/icon.png" --out "$ICONSET/icon_128x128.png"    >/dev/null 2>&1
    sips -z 196 196   "$PROJECT_DIR/src/resources/icon.png" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1

    iconutil -c icns "$ICONSET" -o "$RESOURCES/icon.icns" 2>/dev/null && echo "Created icon.icns"
    rm -rf "$ICONSET"
fi

# Create Info.plist
cat > "$CONTENTS/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>SWG Tracker Desktop</string>
    <key>CFBundleDisplayName</key>
    <string>SWG Tracker Desktop</string>
    <key>CFBundleIdentifier</key>
    <string>com.swgtracker.desktop</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleExecutable</key>
    <string>SWG Tracker Desktop</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
</dict>
</plist>
PLIST

echo ""
echo "Done! Launch with:"
echo "  open \"$APP_DIR\""
echo ""
echo "Or double-click '$APP_NAME.app' in Finder."

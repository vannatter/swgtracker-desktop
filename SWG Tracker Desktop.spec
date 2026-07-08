# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['run_web.py'],
    pathex=[],
    binaries=[],
    datas=[('web', 'web'), ('src/resources', 'src/resources')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SWG Tracker Desktop',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['build/icon.icns'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='SWG Tracker Desktop',
)
app = BUNDLE(
    coll,
    name='SWG Tracker Desktop.app',
    icon='build/icon.icns',
    bundle_identifier='com.swgtracker.desktop',
)

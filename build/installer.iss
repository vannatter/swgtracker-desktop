; Inno Setup script — Windows installer for SWG Tracker Desktop.
; Built in CI (release.yml) with:  ISCC.exe /DAppVersion=x.y.z build\installer.iss
; Why an installer instead of a zip: .NET refuses to load DLLs carrying the
; Mark-of-the-Web that Explorer stamps on zip-extracted files (pythonnet dies
; with "Failed to resolve Python.Runtime.Loader.Initialize"). Files written by
; an installer don't inherit the mark.

#define MyAppName "SWG Tracker Desktop"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{com.swgtracker.desktop}}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppPublisher=swgtracker.com
AppPublisherURL=https://swgtracker.com
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; per-user install by default: no UAC prompt, cleaner future auto-updates
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=SWG-Tracker-Desktop-{#AppVersion}-windows-setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#MyAppName}.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoCompany=swgtracker.com
; the app hides to the tray on X, so Restart Manager's polite close just hid it
; again and setup failed with "unable to close all applications" (Oogie) —
; PrepareToInstall below stops it outright instead
CloseApplications=no
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; Flags: unchecked

[Files]
Source: "..\dist\{#MyAppName}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppName}.exe"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppName}.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppName}.exe"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
// The running app (often tucked in the tray) holds its own files open. A close
// request only re-hides it, so end it — config.json writes are atomic and the
// local DB is SQLite, so a hard stop loses nothing. [Run] relaunches it after.
procedure StopRunningApp();
var
  ResultCode: Integer;
begin
  if Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM "{#MyAppName}.exe"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode)
     and (ResultCode = 0) then
    Sleep(1500);  // WebView2's helper processes let go of the profile a beat later
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningApp();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningApp();
  Result := True;
end;

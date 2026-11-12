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
; %TEMP%\Setup Log <date>.txt — so an install that still trips can be diagnosed
SetupLogging=yes

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
// One kill wasn't always enough (Oogie, after v0.15.5): keep at it until taskkill
// reports nothing left (exit 128). An app started "as administrator" can't be
// ended by a per-user setup at all — False then, and setup says how to quit it
// instead of finishing with locked files and a restart prompt.
function StopRunningApp(): Boolean;
var
  ResultCode, I: Integer;
  Killed: Boolean;
begin
  Killed := False;
  for I := 1 to 10 do
  begin
    if not Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM "{#MyAppName}.exe"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
      Log('taskkill could not run — continuing as before');
      Result := True;
      Exit;
    end;
    Log(Format('taskkill pass %d: exit %d', [I, ResultCode]));
    if ResultCode = 128 then
    begin
      if Killed then
        Sleep(1500);  // WebView2's helper processes let go of the profile a beat later
      Result := True;
      Exit;
    end;
    if ResultCode = 0 then
      Killed := True;
    Sleep(500);
  end;
  Result := False;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if StopRunningApp() then
    Result := ''
  else
    Result := 'SWG Tracker Desktop is still running and Setup could not close it (it may have been started as administrator).' + #13#10#13#10 +
              'Right-click its icon in the system tray and choose Quit, then run Setup again.';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningApp();
  Result := True;
end;

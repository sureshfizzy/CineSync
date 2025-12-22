#define MyAppName "CineSync"
#define MyAppVersion "3.2.1-alpha"
#define MyAppPublisher "CineSync"
#define MyAppURL "https://github.com/sureshfizzy/CineSync"
#define MyAppExeName "CineSync.exe"

[Setup]
AppId={{8F7D9A2C-3B4E-4F5A-9D6E-7C8B9A0E1F2D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes

OutputDir=output
OutputBaseFilename=CineSync-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes

MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

WizardStyle=modern
DisableWelcomePage=no
SetupIconFile=..\..\WebDavHub\frontend\src\assets\logo.ico
UninstallDisplayIcon={app}\WebDavHub\{#MyAppExeName}

LicenseFile=..\..\LICENSE

UninstallDisplayName={#MyAppName}
UninstallFilesDir={app}\uninstall

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full Installation"; Flags: iscustom

[Components]
Name: "core"; Description: "Core Components"; Types: full; Flags: fixed
Name: "core\webdavhub"; Description: "WebDavHub (Go Backend) - API & WebDAV Server"; Types: full; Flags: fixed
Name: "core\mediahub"; Description: "MediaHub (Python Backend) - Media Processing"; Types: full; Flags: fixed
Name: "core\frontend"; Description: "React Web Interface - Modern UI"; Types: full; Flags: fixed

Name: "utilities"; Description: "Bundled Utilities"; Types: full; Flags: fixed
Name: "utilities\rclone"; Description: "Rclone (v1.69.0) - Cloud Storage Mounting"; Types: full; Flags: fixed
Name: "utilities\ffprobe"; Description: "FFprobe - Media Metadata Extraction"; Types: full; Flags: fixed
Name: "utilities\nssm"; Description: "NSSM (2.24) - Windows Service Manager"; Types: full; Flags: fixed

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "build\CineSync.exe"; DestDir: "{app}\WebDavHub"; Flags: ignoreversion
Source: "build\MediaHub\MediaHub.exe"; DestDir: "{app}\MediaHub"; Flags: ignoreversion
Source: "build\MediaHub\ffprobe.exe"; DestDir: "{app}\MediaHub"; Flags: ignoreversion
Source: "build\utils\rclone.exe"; DestDir: "{app}\utils"; Flags: ignoreversion
Source: "build\nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\WebDavHub\frontend\src\assets\logo.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\frontend\dist\*"; DestDir: "{app}\WebDavHub\frontend\dist"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "build\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "build\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "build\BUILD_INFO.txt"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Create necessary directories
Name: "{app}\db"; Permissions: users-full
Name: "{app}\logs"; Permissions: users-full

[Icons]
; Start Menu shortcuts
Name: "{group}\Launch CineSync"; Filename: "http://localhost:8082"; IconFilename: "{app}\logo.ico"; Comment: "Open CineSync Web Interface"
Name: "{group}\Stop CineSync Service"; Filename: "{app}\nssm.exe"; Parameters: "stop CineSync"; Comment: "Stop CineSync Media Server"
Name: "{group}\Restart CineSync Service"; Filename: "{app}\nssm.exe"; Parameters: "restart CineSync"; Comment: "Restart CineSync Media Server"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"; Comment: "Uninstall CineSync"

; Desktop icon with proper icon
Name: "{autodesktop}\{#MyAppName}"; Filename: "http://localhost:8082"; IconFilename: "{app}\logo.ico"; Tasks: desktopicon; Comment: "Launch CineSync Web Interface"

[Run]
; Install Windows Service (nssm.exe is bundled with installer)
Filename: "{app}\nssm.exe"; Parameters: "install CineSync ""{app}\WebDavHub\{#MyAppExeName}"""; StatusMsg: "Installing CineSync as Windows Service..."; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set CineSync AppDirectory ""{app}\WebDavHub"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set CineSync DisplayName ""CineSync Media Server"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set CineSync Description ""CineSync Media Management and Streaming Server"""; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set CineSync Start SERVICE_AUTO_START"; Flags: runhidden
; Redirect stdout/stderr to NUL since we use file logging
Filename: "{app}\nssm.exe"; Parameters: "set CineSync AppStdout NUL"; Flags: runhidden
Filename: "{app}\nssm.exe"; Parameters: "set CineSync AppStderr NUL"; Flags: runhidden

; Start the service immediately
Filename: "{app}\nssm.exe"; Parameters: "start CineSync"; StatusMsg: "Starting CineSync Media Server..."; Flags: runhidden waituntilterminated

; Launch CineSync UI after installation completes
Filename: "http://localhost:8082"; Description: "Launch CineSync Web Interface"; Flags: postinstall shellexec skipifsilent

[UninstallRun]
; Stop and remove Windows Service on uninstall
Filename: "{app}\nssm.exe"; Parameters: "stop CineSync"; Flags: runhidden; RunOnceId: "StopService"
Filename: "{app}\nssm.exe"; Parameters: "remove CineSync confirm"; Flags: runhidden; RunOnceId: "RemoveService"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\*.log"

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
end;

[Messages]
WelcomeLabel2=This will install [name/ver] on your computer.%n%nIt is recommended that you close all other applications before continuing.
FinishedHeadingLabel=Installation Complete!
FinishedLabelNoIcons=CineSync Media Server has been installed successfully.%n%nThe service is now running. Access the web interface at:%nhttp://localhost:8082
FinishedLabel=CineSync Media Server has been installed successfully.%n%nThe service is now running and will start automatically on system boot.%n%nClick "Launch CineSync Web Interface" below to open the application.

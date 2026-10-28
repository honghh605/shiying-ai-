; 拾影 · Inno Setup 安装包脚本
; 编译：ISCC.exe installer\setup.iss

#define MyAppName "拾影"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "拾影"
#define MyAppExeName "拾影.exe"
#define MyAppId "{{8F4C2A31-6B7D-4E2A-9C5F-3A1D7B9E2C64}}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion=1.0.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} 安装程序
DefaultDirName={localappdata}\Programs\ActivityPhotoCull
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
#ifndef MyOutputBase
  #define MyOutputBase "拾影-安装包-v1.0.0"
#endif
OutputBaseFilename={#MyOutputBase}
SetupIconFile=..\app\web\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
SetupLogging=yes
ShowLanguageDialog=no
UsePreviousAppDir=no
AllowNoIcons=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chs"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务："; Flags: checkedonce

[Files]
Source: "..\dist\拾影\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "WebView2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "..\README.md"; DestDir: "{app}"; DestName: "使用说明.md"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\WebView2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "正在准备 WebView2 运行环境…"; Flags: runhidden waituntilterminated; Check: NeedsWebView2
Filename: "{app}\{#MyAppExeName}"; Description: "立即运行 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
function NeedsWebView2: Boolean;
begin
  Result := not (
    RegKeyExists(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') or
    RegKeyExists(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}') or
    RegKeyExists(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')
  );
end;

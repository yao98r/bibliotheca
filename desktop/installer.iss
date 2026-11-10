[Setup]
AppId={{DA592DB7-2BCA-49A4-BDCA-6E50B2B7FA03}
AppName=天河 PDF 畫質工坊
AppVersion=1.0.0
AppPublisher=天眼
DefaultDirName={localappdata}\Programs\TianhePDF
DefaultGroupName=天河 PDF 畫質工坊
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\outputs\desktop-1110
OutputBaseFilename=TianhePDF-Setup-1.0.0
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\TianhePDF.exe
CloseApplications=no

[Languages]
Name: "zhTW"; MessagesFile: "compiler:Languages\ChineseTraditional.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑"; Flags: unchecked

[Files]
Source: "dist\TianhePDF\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "README.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "Source\*"; DestDir: "{app}\Source"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Licenses\*"; DestDir: "{app}\Licenses"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\天河 PDF 畫質工坊"; Filename: "{app}\TianhePDF.exe"
Name: "{group}\使用說明"; Filename: "{app}\README.txt"
Name: "{autodesktop}\天河 PDF 畫質工坊"; Filename: "{app}\TianhePDF.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TianhePDF.exe"; Description: "開啟天河 PDF 畫質工坊"; Flags: nowait postinstall skipifsilent


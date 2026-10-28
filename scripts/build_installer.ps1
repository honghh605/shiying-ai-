# 构建安装包（先构建 exe，再调用 Inno Setup 编译安装包）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1) 使用 PyInstaller 产物；若不存在则先构建
$appExe = Join-Path $root 'dist\拾影\拾影.exe'
if (-not (Test-Path $appExe)) {
    PowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build_zip.ps1')
}

# 2) 定位 Inno Setup 编译器
$isccCandidates = @(
    'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    'C:\Program Files\Inno Setup 6\ISCC.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
)
$iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw '未找到 Inno Setup 6 的 ISCC.exe，请先安装 Inno Setup 6' }

# 3) 编译安装包
& $iscc (Join-Path $root 'installer\setup.iss')
if ($LASTEXITCODE -ne 0) { throw "Inno Setup 编译失败：$LASTEXITCODE" }

$installer = Join-Path $root 'dist\拾影-安装包-v1.0.0.exe'
if (-not (Test-Path $installer)) { throw '未生成安装包' }

# 4) 增量升级包：与基础版共用 AppId，双击覆盖安装并保留用户数据
& $iscc "/DMyOutputBase=拾影-升级包-v1.0.0" (Join-Path $root 'installer\setup.iss')
if ($LASTEXITCODE -ne 0) { throw "升级包编译失败：$LASTEXITCODE" }
$updater = Join-Path $root 'dist\拾影-升级包-v1.0.0.exe'
if (-not (Test-Path $updater)) { throw '未生成升级包' }

Write-Output "升级包完成：$updater"
Write-Output "安装包完成：$installer"
Write-Output "文件大小：$([math]::Round((Get-Item $installer).Length / 1MB, 1)) MB"

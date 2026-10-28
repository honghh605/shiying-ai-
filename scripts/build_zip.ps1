# 构建并打包 Windows 发行 zip（在项目根目录运行）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw '未找到 .venv，请先按 README 创建虚拟环境并安装依赖' }

$name = '拾影'
$dist = Join-Path $root 'dist'
$build = Join-Path $root 'build'
$output = Join-Path $dist $name

if (Test-Path $output) { Remove-Item -Recurse -Force $output }

& $python -m PyInstaller `
  --noconfirm --clean --windowed `
  --name $name `
  --icon "$root\app\web\icon.ico" `
  --distpath $dist --workpath $build --specpath $build `
  --add-data "$root\app\web;app\web" `
  --add-data "$root\app\models;app\models" `
  --collect-binaries cv2 `
  --hidden-import cv2 `
  --collect-binaries onnxruntime `
  --collect-data onnxruntime `
  --hidden-import onnxruntime `
  --hidden-import onnxruntime.capi._pybind_state `
  --collect-binaries rawpy `
  --collect-data rawpy `
  --hidden-import exifread `
  --hidden-import webview.platforms.edgechromium `
  --hidden-import webview.platforms.winforms `
  --hidden-import clr `
  --collect-submodules pystray `
  --hidden-import pystray `
  --hidden-import uvicorn.logging `
  --hidden-import uvicorn.loops.auto `
  --hidden-import uvicorn.loops.asyncio `
  --hidden-import uvicorn.protocols.http.auto `
  --hidden-import uvicorn.protocols.http.h11_impl `
  --hidden-import uvicorn.protocols.websockets.auto `
  --hidden-import uvicorn.lifespan.on `
  --hidden-import uvicorn.lifespan.off `
  launcher.py

Copy-Item (Join-Path $root 'README.md') (Join-Path $output '使用说明.md')

$zip = Join-Path $dist "$name-v1.0.0-win64.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
# 打包整个文件夹：解压后得到一个完整目录，避免文件散落
Compress-Archive -Path $output -DestinationPath $zip -CompressionLevel Optimal
Write-Output "打包完成：$zip"
Write-Output "解压后双击 $name\$name.exe 运行。"

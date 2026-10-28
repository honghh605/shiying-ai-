param(
    [string]$Repo = "OWNER/shiying",
    [string]$Tag = "v1.0.0",
    [string]$ZipPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$models = Join-Path $root "app\models"
New-Item -ItemType Directory -Path $models -Force | Out-Null

$required = @(
    "clip_vision_vit_b32_float.onnx",
    "face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx"
)

$existing = @($required | Where-Object { -not (Test-Path (Join-Path $models $_)) })
if ($existing.Count -eq 0) {
    Write-Host "模型已就绪：$models"
    exit 0
}

if (-not $ZipPath) {
    $archive = Join-Path $env:TEMP ("shiying-models-" + $Tag + ".zip")
    $url = "https://github.com/$Repo/releases/download/$Tag/models-$Tag.zip"
    Write-Host "下载模型：$url"
    Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
    $ZipPath = $archive
}

if (-not (Test-Path $ZipPath)) {
    throw "找不到模型压缩包：$ZipPath"
}

$extract = Join-Path $env:TEMP ("shiying-models-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $extract -Force | Out-Null
Expand-Archive -Path $ZipPath -DestinationPath $extract -Force

# 支持压缩包内直接放模型或放在 models/ 子目录两种结构
Get-ChildItem $extract -Recurse -File -Filter "*.onnx" | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $models $_.Name) -Force
}

Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue

$missing = @($required | Where-Object { -not (Test-Path (Join-Path $models $_)) })
if ($missing.Count -gt 0) {
    throw "模型不完整，缺少：$($missing -join ', ')"
}
Write-Host "模型安装完成：$models"

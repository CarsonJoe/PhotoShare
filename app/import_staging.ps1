param()

$ErrorActionPreference = 'Stop'

function Ensure-Dir([string]$p){ if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }

function Next-AvailableName([string]$dir, [string]$base, [string]$ext){
  $n = 0
  do {
    $suffix = if ($n -eq 0) { '' } else { "_$n" }
    $name = "$base$suffix$ext"
    $target = Join-Path $dir $name
    if (-not (Test-Path $target)) { return $target }
    $n++
  } while ($true)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$stagingDir = Join-Path $repoRoot 'staging'
$photosDir = Join-Path $repoRoot 'photos'

if (-not (Test-Path $stagingDir)) { exit 0 }

$allowed = @('.jpg','.jpeg','.png','.gif','.webp','.JPG','.JPEG','.PNG','.GIF','.WEBP')

Get-ChildItem -Path $stagingDir -Directory | ForEach-Object {
  $album = $_.Name
  $srcAlbum = $_.FullName
  $dstAlbum = Join-Path $photosDir $album
  Ensure-Dir $dstAlbum

  Get-ChildItem -Path $srcAlbum -File | Where-Object { $allowed -contains $_.Extension } | ForEach-Object {
    $file = $_
    $base = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $ext = [System.IO.Path]::GetExtension($file.Name)
    $target = Next-AvailableName -dir $dstAlbum -base $base -ext $ext
    Move-Item -LiteralPath $file.FullName -Destination $target
  }
  # Clean up album folder if empty
  if ((Get-ChildItem -Path $srcAlbum -Recurse | Measure-Object).Count -eq 0) {
    Remove-Item -LiteralPath $srcAlbum -Force -Recurse
  }
}

# Clean up staging if empty
if ((Get-ChildItem -Path $stagingDir -Recurse | Measure-Object).Count -eq 0) {
  Remove-Item -LiteralPath $stagingDir -Force -Recurse
}

Write-Host "Imported staged photos into" (Resolve-Path $photosDir)


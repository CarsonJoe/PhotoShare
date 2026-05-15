param()

$ErrorActionPreference = 'Stop'

function ToWebPath([string]$p){
  return ($p -replace '\\','/').TrimStart('./')
}

function Ensure-Dir([string]$p){
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

# Load System.Drawing for image processing (Windows-only)
Add-Type -AssemblyName System.Drawing
# Optionally load WPF imaging for WIC thumbnail fallback (if available)
try { Add-Type -AssemblyName PresentationCore, WindowsBase } catch {}

function Get-JpegCodec() {
  return [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
}

function Get-ThumbPath([string]$thumbsRoot, [IO.FileInfo]$srcFile, [string]$groupName){
  $base = [System.IO.Path]::GetFileNameWithoutExtension($srcFile.Name)
  $dstDir = Join-Path $thumbsRoot $groupName
  Ensure-Dir $dstDir
  return Join-Path $dstDir ("$base.jpg")
}

function Ensure-Thumbnail([string]$srcPath, [string]$dstPath, [int]$maxWidth){
  $img = $null
  $thumb = $null
  $g = $null
  try{
    $srcInfo = Get-Item -LiteralPath $srcPath -ErrorAction Stop
    $dstExists = Test-Path -LiteralPath $dstPath
    $img = [System.Drawing.Image]::FromFile($srcPath)

    # Apply EXIF orientation when present
    $orientationId = 0x0112
    if ($img.PropertyIdList -contains $orientationId) {
      $prop = $img.GetPropertyItem($orientationId)
      $o = [System.BitConverter]::ToUInt16($prop.Value, 0)
      switch ($o) {
        3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
        6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
        8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
        default { }
      }
    }

    $origW = [int]$img.Width
    $origH = [int]$img.Height
    $scale = if ($origW -gt $maxWidth) { $maxWidth / $origW } else { 1.0 }
    $newW = [int][Math]::Round($origW * $scale)
    $newH = [int][Math]::Round($origH * $scale)

    $needsWrite = $true
    if ($dstExists) {
      $dstInfo = Get-Item -LiteralPath $dstPath
      $needsWrite = $dstInfo.LastWriteTimeUtc -lt $srcInfo.LastWriteTimeUtc
    }

    if ($needsWrite) {
      $thumb = New-Object System.Drawing.Bitmap $newW, $newH
      $g = [System.Drawing.Graphics]::FromImage($thumb)
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($img, 0, 0, $newW, $newH)

      $jpeg = Get-JpegCodec
      $enc = [System.Drawing.Imaging.Encoder]::Quality
      $eps = New-Object System.Drawing.Imaging.EncoderParameters 1
      $ep = New-Object System.Drawing.Imaging.EncoderParameter $enc, ([long]80)
      $eps.Param[0] = $ep

      $thumb.Save($dstPath, $jpeg, $eps)
    }

    return [PSCustomObject]@{
      width = $origW
      height = $origH
      thumbWidth = $newW
      thumbHeight = $newH
    }
  } catch {
    Write-Warning ("Failed to create thumbnail for {0}: {1}" -f $srcPath, $_.Exception.Message)
    return $null
  } finally {
    if ($g) { $g.Dispose() }
    if ($thumb) { $thumb.Dispose() }
    if ($img) { $img.Dispose() }
  }
}


$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$photosDir = Join-Path $repoRoot 'photos'
$thumbsDir = Join-Path $photosDir '_thumbs'
$manifestPath = Join-Path $scriptDir 'photos.json'
$settingsPath = Join-Path $scriptDir 'photo-settings.json'

Ensure-Dir $photosDir
Ensure-Dir $thumbsDir

$allowed = @('.jpg','.jpeg','.png','.gif','.webp','.JPG','.JPEG','.PNG','.GIF','.WEBP')
$maxThumbWidth = 600

$settings = [PSCustomObject]@{ favorites = @(); hiddenPhotos = @(); privateGroups = @() }
if (Test-Path -LiteralPath $settingsPath) {
  try {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  } catch {
    Write-Warning ("Failed to read {0}: {1}" -f $settingsPath, $_.Exception.Message)
  }
}
$hiddenPhotos = @{}
@($settings.hiddenPhotos) | ForEach-Object { if ($_){ $hiddenPhotos[[string]$_] = $true } }
$privateGroups = @{}
@($settings.privateGroups) | ForEach-Object { if ($_){ $privateGroups[[string]$_] = $true } }

$groups = @()
Get-ChildItem -Path $photosDir -Directory | Where-Object { $_.Name -ne '_thumbs' } | ForEach-Object {
  $group = $_
  $files = Get-ChildItem -Path $group.FullName -File | Where-Object { $allowed -contains $_.Extension } | Sort-Object Name
  $relPhotos = @()
  $relThumbs = @()
  $items = @()
  foreach($f in $files){
    $rel = Join-Path 'photos' (Join-Path $group.Name $f.Name)
    $relWeb = ToWebPath $rel
    if ($hiddenPhotos.ContainsKey($relWeb)) { continue }
    $relPhotos += $relWeb

    $thumbPath = Get-ThumbPath -thumbsRoot $thumbsDir -srcFile $f -groupName $group.Name
    $meta = Ensure-Thumbnail -srcPath $f.FullName -dstPath $thumbPath -maxWidth $maxThumbWidth
    $thumbRel = ToWebPath ($thumbPath.Substring($repoRoot.Path.Length + 1))
    $relThumbs += $thumbRel

    $items += [PSCustomObject]@{
      src = $relWeb
      thumb = $thumbRel
      name = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
      width = if ($meta) { $meta.width } else { $null }
      height = if ($meta) { $meta.height } else { $null }
    }

  }
  $cover = if ($relPhotos.Count -gt 0) { $relPhotos[0] } else { $null }
  $coverThumb = if ($relThumbs.Count -gt 0) { $relThumbs[0] } else { $null }
  $groups += [PSCustomObject]@{
    id = $group.Name
    name = ($group.Name -replace '_',' ')
    visibility = if ($privateGroups.ContainsKey($group.Name)) { 'private' } else { 'public' }
    cover = $cover
    coverThumb = $coverThumb
    photos = $relPhotos
    thumbs = $relThumbs
    items = $items
  }
}

$manifest = [PSCustomObject]@{
  generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  thumbWidth = $maxThumbWidth
  favorites = @($settings.favorites) | Where-Object { $_ -and -not $hiddenPhotos.ContainsKey([string]$_) }
  hiddenPhotos = @($settings.hiddenPhotos)
  groups = $groups
  locations = @()
}

$json = $manifest | ConvertTo-Json -Depth 6
Set-Content -Path $manifestPath -Value $json -Encoding UTF8
Write-Host "Wrote manifest to" (Resolve-Path $manifestPath)

# Write an inline script so the app works when opened via file:// (no server).
# Browsers block fetch() on file:// origins; loading a <script> tag is exempt.
$inlinePath = Join-Path $scriptDir 'photos-inline.js'
$inlineContent = "window.__PHOTOSHARE_MANIFEST__ = $json;"
Set-Content -Path $inlinePath -Value $inlineContent -Encoding UTF8
Write-Host "Wrote inline manifest to" (Resolve-Path $inlinePath)

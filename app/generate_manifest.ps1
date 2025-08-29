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
  try{
    $srcInfo = Get-Item -LiteralPath $srcPath -ErrorAction Stop
    $dstExists = Test-Path -LiteralPath $dstPath
    if ($dstExists) {
      $dstInfo = Get-Item -LiteralPath $dstPath
      if ($dstInfo.LastWriteTimeUtc -ge $srcInfo.LastWriteTimeUtc) { return }
    }

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

    $origW = [double]$img.Width
    $origH = [double]$img.Height
    $scale = if ($origW -gt $maxWidth) { $maxWidth / $origW } else { 1.0 }
    $newW = [int][Math]::Round($origW * $scale)
    $newH = [int][Math]::Round($origH * $scale)

    $thumb = New-Object System.Drawing.Bitmap $newW, $newH
    $g = [System.Drawing.Graphics]::FromImage($thumb)
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $newW, $newH)
    $g.Dispose()

    $jpeg = Get-JpegCodec
    $enc = [System.Drawing.Imaging.Encoder]::Quality
    $eps = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep = New-Object System.Drawing.Imaging.EncoderParameter $enc, ([long]80)
    $eps.Param[0] = $ep

    $thumb.Save($dstPath, $jpeg, $eps)
    $thumb.Dispose()
    $img.Dispose()
  } catch {
    Write-Warning ("Failed to create thumbnail for {0}: {1}" -f $srcPath, $_.Exception.Message)
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$photosDir = Join-Path $repoRoot 'photos'
$thumbsDir = Join-Path $photosDir '_thumbs'
$manifestPath = Join-Path $scriptDir 'photos.json'

Ensure-Dir $photosDir
Ensure-Dir $thumbsDir

$allowed = @('.jpg','.jpeg','.png','.gif','.webp','.JPG','.JPEG','.PNG','.GIF','.WEBP')
$maxThumbWidth = 600

$groups = @()
Get-ChildItem -Path $photosDir -Directory | Where-Object { $_.Name -ne '_thumbs' } | ForEach-Object {
  $group = $_
  $files = Get-ChildItem -Path $group.FullName -File | Where-Object { $allowed -contains $_.Extension } | Sort-Object Name
  $relPhotos = @()
  $relThumbs = @()
  foreach($f in $files){
    $rel = Join-Path 'photos' (Join-Path $group.Name $f.Name)
    $relPhotos += (ToWebPath $rel)

    $thumbPath = Get-ThumbPath -thumbsRoot $thumbsDir -srcFile $f -groupName $group.Name
    Ensure-Thumbnail -srcPath $f.FullName -dstPath $thumbPath -maxWidth $maxThumbWidth
    $thumbRel = ToWebPath ($thumbPath.Substring($repoRoot.Path.Length + 1))
    $relThumbs += $thumbRel
  }
  $cover = if ($relPhotos.Count -gt 0) { $relPhotos[0] } else { $null }
  $coverThumb = if ($relThumbs.Count -gt 0) { $relThumbs[0] } else { $null }
  $groups += [PSCustomObject]@{
    id = $group.Name
    name = ($group.Name -replace '_',' ')
    cover = $cover
    coverThumb = $coverThumb
    photos = $relPhotos
    thumbs = $relThumbs
  }
}

$manifest = [PSCustomObject]@{
  generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  thumbWidth = $maxThumbWidth
  groups = $groups
}

$json = $manifest | ConvertTo-Json -Depth 5
Set-Content -Path $manifestPath -Value $json -Encoding UTF8
Write-Host "Wrote manifest to" (Resolve-Path $manifestPath)

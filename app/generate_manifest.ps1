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
# Also load WIC metadata APIs for GPS (PresentationCore)
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

function To-URational([byte[]]$bytes, [int]$offset){
  $num = [BitConverter]::ToUInt32($bytes, $offset)
  $den = [BitConverter]::ToUInt32($bytes, $offset + 4)
  if ($den -eq 0) { return 0 }
  return [double]$num / [double]$den
}

function From-DMS([double[]]$dms, [string]$ref){
  if ($dms.Count -lt 3) { return $null }
  $deg = $dms[0]; $min = $dms[1]; $sec = $dms[2]
  $val = $deg + ($min/60.0) + ($sec/3600.0)
  if ($ref -in @('S','W')) { $val = -$val }
  return $val
}

function Try-GetGps-SystemDrawing([string]$path){
  try{
    $img = [System.Drawing.Image]::FromFile($path)
    $idLatRef = 0x0001; $idLat = 0x0002; $idLonRef = 0x0003; $idLon = 0x0004
    if (-not ($img.PropertyIdList -contains $idLat -and $img.PropertyIdList -contains $idLon)) { $img.Dispose(); return $null }
    $latRef = [System.Text.Encoding]::ASCII.GetString($img.GetPropertyItem($idLatRef).Value).Trim([char]0)
    $lonRef = [System.Text.Encoding]::ASCII.GetString($img.GetPropertyItem($idLonRef).Value).Trim([char]0)
    $latVal = $img.GetPropertyItem($idLat).Value
    $lonVal = $img.GetPropertyItem($idLon).Value
    $img.Dispose()
    $lat = @(
      To-URational $latVal 0,
      To-URational $latVal 8,
      To-URational $latVal 16
    )
    $lon = @(
      To-URational $lonVal 0,
      To-URational $lonVal 8,
      To-URational $lonVal 16
    )
    $dlat = From-DMS $lat $latRef
    $dlon = From-DMS $lon $lonRef
    if ($dlat -and $dlon) { return @{ lat=$dlat; lon=$dlon } }
  } catch {}
  return $null
}

function Try-GetGps-WIC([string]$path){
  try{
    $fs = [System.IO.File]::OpenRead($path)
    try{
      $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($fs, [System.Windows.Media.Imaging.BitmapCreateOptions]::IgnoreColorProfile, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
      $frame = $decoder.Frames[0]
      $meta = [System.Windows.Media.Imaging.BitmapMetadata]$frame.Metadata
      if (-not $meta) { return $null }
      $latRef = $meta.GetQuery('/app1/ifd/gps/{ushort=1}')
      $latArr = $meta.GetQuery('/app1/ifd/gps/{ushort=2}')
      $lonRef = $meta.GetQuery('/app1/ifd/gps/{ushort=3}')
      $lonArr = $meta.GetQuery('/app1/ifd/gps/{ushort=4}')
      if (-not $latArr -or -not $lonArr) { return $null }
      # Arrays of rationals: each element has Numerator and Denominator
      $latD = @()
      foreach($r in $latArr){ $latD += ([double]$r.Numerator / [double][math]::Max(1,$r.Denominator)) }
      $lonD = @()
      foreach($r in $lonArr){ $lonD += ([double]$r.Numerator / [double][math]::Max(1,$r.Denominator)) }
      $dlat = From-DMS $latD ([string]$latRef)
      $dlon = From-DMS $lonD ([string]$lonRef)
      if ($dlat -and $dlon) { return @{ lat=$dlat; lon=$dlon } }
    } finally { $fs.Dispose() }
  } catch {}
  return $null
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
$locations = @()
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

    # Attempt GPS extraction for JPEGs only (EXIF)
    if ($f.Extension -match '^(?i)\.jpe?g$') {
      $gps = Try-GetGps-SystemDrawing $f.FullName
      if (-not $gps) { $gps = Try-GetGps-WIC $f.FullName }
      if ($gps -and $gps.lat -and $gps.lon) {
        $locations += [PSCustomObject]@{
          groupId = $group.Name
          name = $f.Name
          path = (ToWebPath $rel)
          thumb = $thumbRel
          lat = [Math]::Round([double]$gps.lat, 6)
          lon = [Math]::Round([double]$gps.lon, 6)
        }
      }
    }
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
  locations = $locations
}

$json = $manifest | ConvertTo-Json -Depth 5
Set-Content -Path $manifestPath -Value $json -Encoding UTF8
Write-Host "Wrote manifest to" (Resolve-Path $manifestPath)

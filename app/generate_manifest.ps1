param()

$ErrorActionPreference = 'Stop'

function ToWebPath([string]$p){
  return ($p -replace '\\','/').TrimStart('./')
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir '..')
$photosDir = Join-Path $repoRoot 'photos'
$manifestPath = Join-Path $scriptDir 'photos.json'

if (-not (Test-Path $photosDir)) {
  New-Item -ItemType Directory -Path $photosDir | Out-Null
}

$allowed = @('.jpg','.jpeg','.png','.gif','.webp','.JPG','.JPEG','.PNG','.GIF','.WEBP')

$groups = @()
Get-ChildItem -Path $photosDir -Directory | ForEach-Object {
  $group = $_
  $files = Get-ChildItem -Path $group.FullName -File | Where-Object { $allowed -contains $_.Extension } | Sort-Object Name
  $relPhotos = @()
  foreach($f in $files){
    $rel = Join-Path 'photos' (Join-Path $group.Name $f.Name)
    $relPhotos += (ToWebPath $rel)
  }
  $cover = if ($relPhotos.Count -gt 0) { $relPhotos[0] } else { $null }
  $groups += [PSCustomObject]@{
    id = $group.Name
    name = ($group.Name -replace '_',' ')
    cover = $cover
    photos = $relPhotos
  }
}

$manifest = [PSCustomObject]@{
  generatedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  groups = $groups
}

$json = $manifest | ConvertTo-Json -Depth 5
Set-Content -Path $manifestPath -Value $json -Encoding UTF8
Write-Host "Wrote manifest to" (Resolve-Path $manifestPath)


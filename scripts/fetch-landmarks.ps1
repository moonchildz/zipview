$ErrorActionPreference = 'Stop'
$directory = Join-Path (Get-Location) 'research\sinchon-prugio\outlook\landmarks'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$requests = @{
  'yeouido.osm' = 'map?bbox=126.919,37.516,126.943,37.531'
  'center.osm' = 'map?bbox=126.967,37.551,126.982,37.570'
  'jamsil.osm' = 'map?bbox=127.100,37.510,127.106,37.515'
  'lotte.json' = 'relation/8824257/full.json'
}
foreach ($entry in $requests.GetEnumerator()) {
  $path = Join-Path $directory $entry.Key
  if (Test-Path -LiteralPath $path) { continue }
  Invoke-WebRequest -Uri ('https://api.openstreetmap.org/api/0.6/' + $entry.Value) -OutFile $path -UseBasicParsing -TimeoutSec 60
}
$tower = Join-Path (Split-Path $directory -Parent) 'n-seoul-tower-osm.json'
if (-not (Test-Path -LiteralPath $tower)) {
  Invoke-WebRequest -Uri 'https://api.openstreetmap.org/api/0.6/relation/16474080/full.json' -OutFile $tower -UseBasicParsing -TimeoutSec 60
}
Write-Output 'Snapshots ready. Run node scripts/fetch-landmarks.mjs then node scripts/prepare-outlook.mjs.'

$ErrorActionPreference = 'Stop'
$directory = Join-Path (Get-Location) 'research\sinchon-prugio\outlook'
$url = 'https://api.openstreetmap.org/api/0.6/map?bbox=126.942,37.551,126.964,37.57'
Invoke-WebRequest -Uri $url -UseBasicParsing -OutFile (Join-Path $directory 'osm.xml') -TimeoutSec 60
$xml = New-Object System.Xml.XmlDocument
$xml.Load((Join-Path $directory 'osm.xml'))
$nodes = @{}
foreach ($node in $xml.osm.node) { $nodes[$node.id] = @{lat=[double]$node.lat; lon=[double]$node.lon} }
$elements = @()
foreach ($way in $xml.osm.way) {
    $tags = @{}
    foreach ($tag in $way.tag) { if ($tag.k) { $tags[$tag.k] = [string]$tag.v } }
    if (-not ($tags.ContainsKey('building') -or $tags.ContainsKey('highway') -or $tags.ContainsKey('landuse') -or $tags.ContainsKey('leisure'))) { continue }
    $geometry = @($way.nd | ForEach-Object { $nodes[$_.ref] })
    if ($geometry.Count -lt 2 -or $geometry -contains $null) { continue }
    $elements += @{id=[long]$way.id; tags=$tags; geometry=$geometry}
}
$data = @{source=$url; fetchedAt=[DateTime]::UtcNow.ToString('o'); attribution='OpenStreetMap contributors'; license='ODbL 1.0'; elements=$elements}
$json = $data | ConvertTo-Json -Depth 12 -Compress
[IO.File]::WriteAllText((Join-Path $directory 'osm.json'), $json, [Text.UTF8Encoding]::new($false))
Write-Output ('Features: ' + $elements.Count)
$elements | Where-Object { $_.tags.building -and @($_.geometry | Where-Object { [Math]::Abs($_.lat - 37.5604532) -lt 0.002 -and [Math]::Abs($_.lon - 126.9524504) -lt 0.002 }).Count -gt 0 } | ForEach-Object { @{id=$_.id;tags=$_.tags;center=@(($_.geometry.lon | Measure-Object -Average).Average,($_.geometry.lat | Measure-Object -Average).Average)} } | ConvertTo-Json -Depth 5

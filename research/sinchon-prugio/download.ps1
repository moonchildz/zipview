$ErrorActionPreference = 'Stop'
$assets = @{
    'site-perspective' = '236840505555B2B007'
    'site-and-units' = '263638505555B2AE27'
    '84A' = '22795244556D477216'
    '84B' = '22477044556D477536'
    '84C' = '26526C44556D47782F'
    '84D' = '244AD244556D477B35'
    '84E' = '251C4144556D477F02'
    '109A' = '225DD241556D47882C'
    '109B' = '245F5D41556D478D2B'
}
foreach ($asset in $assets.GetEnumerator()) {
    $url = 'https://t1.daumcdn.net/cfile/blog/' + $asset.Value
    $target = Join-Path $PSScriptRoot ('images/' + $asset.Key + '.jpg')
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
    Write-Output ($asset.Key + ': ' + (Get-Item -LiteralPath $target).Length + ' bytes')
}

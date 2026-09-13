param(
    [int]$ChromeProcessId = 0,
    [string]$StateDirectory = '.tools/ngii-downloads',
    [switch]$TransferOnly,
    [switch]$Once,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
. (Join-Path $PSScriptRoot 'ngii-ui-policy.ps1')
if ($ChromeProcessId -eq 0) {
    $taskCandidates = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
        $_.CommandLine -match 'Zipview[\\/]ngii-browser-chrome' -and $_.CommandLine -notmatch '--type='
    })
    if ($taskCandidates.Count -ne 1) { throw 'Expected exactly one Zipview task Chrome browser.' }
    $ChromeProcessId = $taskCandidates[0].ProcessId
}
$taskChrome = Get-CimInstance Win32_Process -Filter "ProcessId = $ChromeProcessId"
if (!$taskChrome -or $taskChrome.Name -ne 'chrome.exe' -or $taskChrome.CommandLine -notmatch 'Zipview[\\/]ngii-browser-chrome') {
    throw 'Only the Zipview task Chrome process may be controlled.'
}
$stateRoot = [IO.Path]::GetFullPath($StateDirectory)
$manifestPath = Join-Path $stateRoot 'manifest.json'
$lockPath = Join-Path $stateRoot 'ui-watch.lock'
$watchLock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::Read)
$attempted = @{}
$lastCandidate = ''
$scopes = [System.Windows.Automation.TreeScope]
$element = [System.Windows.Automation.AutomationElement]
$types = [System.Windows.Automation.ControlType]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
try {
    Write-Output "Watching NGII download buttons in task Chrome PID $ChromeProcessId (existing window)."
    do {
        if (!(Get-Process -Id $ChromeProcessId -ErrorAction SilentlyContinue)) { break }
        $manifestStream = [IO.FileStream]::new($manifestPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        $manifestReader = [IO.StreamReader]::new($manifestStream,[Text.Encoding]::UTF8)
        try { $manifest = $manifestReader.ReadToEnd() | ConvertFrom-Json }
        finally { $manifestReader.Dispose() }
        if ($manifest.schemaVersion -ne 1 -or $manifest.product -ne '수치지도2.0' -or $manifest.scale -ne 1000) { throw 'Unexpected manifest.' }
        $requested = @($manifest.sheets | Where-Object status -eq 'requested' | ForEach-Object number)
        if (@($manifest.sheets | Where-Object status -ne 'verified').Count -eq 0) { Write-Output 'All files verified. UI watcher finished.'; break }
        $windows = $element::RootElement.FindAll($scopes::Children,[System.Windows.Automation.Condition]::TrueCondition)
        $candidateFound = $false
        foreach ($window in $windows) {
            try {
                if ($window.Current.ProcessId -ne $ChromeProcessId) { continue }
                $title = $window.Current.Name
                if ($title -notmatch '^(신청 파일 다운로드|국토정보플랫폼 국토정보맵).*Chrome$') { continue }
                $kind = if ($title -match '^신청 파일 다운로드') { 'transfer' } else { 'application' }
                if ($TransferOnly -and $kind -eq 'application') { continue }
                $nodes = $window.FindAll($scopes::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
                $buttons = @($nodes | Where-Object { $_.Current.ControlType -eq $types::Button -and $_.Current.IsEnabled -and !$_.Current.IsOffscreen })
                $download = @($buttons | Where-Object { $_.Current.Name -eq '다운로드' })
                $all = @($buttons | Where-Object { $_.Current.Name -eq '전체 다운로드' })
                $start = @($buttons | Where-Object { $_.Current.ClassName -match '^irx_controller' -and $_.Current.Name -match '^(다운로드|전송시작|전송 시작|시작)$' })
                $transferring = @($buttons | Where-Object { $_.Current.ClassName -match '^irx_controller' -and $_.Current.Name -match '전송중지|전송 중지|일시정지' }).Count -gt 0
                $hasFooter = $false
                if ($kind -eq 'application' -and $download.Count -eq 1) {
                    $parent = $walker.GetParent($download[0])
                    $hasFooter = $null -ne $parent -and $parent.Current.ClassName -eq 'popup function'
                }
                $numbers = @()
                if ($kind -eq 'transfer') {
                    $numbers = @($nodes | Where-Object { $_.Current.ControlType -eq $types::ListItem } | ForEach-Object {
                        if ($_.Current.Name -match '^\(B010\)수치지도_(\d{9})_\d{4}_') { $Matches[1] }
                    } | Sort-Object -Unique)
                }
                $snapshot = @{ TrustedProcess=$true; Kind=$kind; DownloadButtonCount=$download.Count; HasFormFooter=$hasFooter;
                    FileNumbers=$numbers; Transferring=$transferring; StartButtonCount=$start.Count; AllButtonCount=$all.Count }
                $decision = Select-NgiiUiAction -Snapshot $snapshot -Requested $requested -Attempted $attempted
                if ($null -eq $decision) { continue }
                $candidateFound = $true
                # Require a stable candidate in consecutive scans; let scripts finish rendering first.
                if ($DryRun) { Write-Output "Would invoke $($decision.Action) for $($requested.Count) requested sheets."; continue }
                if ($lastCandidate -ne $decision.Key) { $lastCandidate=$decision.Key; continue }
                $button = switch ($decision.Action) { 'application' { $download[0] }; 'all' { $all[0] }; 'start' { $start[0] } }
                $pattern = $null
                if (!$button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { continue }
                # Mark before invocation: never repeat a potentially accepted request.
                $attempted[$decision.Key] = $true
                $pattern.Invoke()
                Write-Output "$(Get-Date -Format HH:mm:ss) Invoked $($decision.Action) for $($requested.Count) requested sheets."
                $lastCandidate = ''
            } catch [System.Windows.Automation.ElementNotAvailableException] {
                # Normal popup replacement between batches; rediscover on the next scan.
                continue
            }
        }
        if (!$candidateFound) { $lastCandidate='' }
        if (!$Once) { Start-Sleep -Seconds 3 }
    } while (!$Once)
} finally {
    $watchLock.Dispose()
    Remove-Item -LiteralPath $lockPath
}
